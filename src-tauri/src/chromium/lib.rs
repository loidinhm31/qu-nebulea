use crate::{get_chrome_sessions, get_next_message_id};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

#[derive(Debug, Serialize, Deserialize)]
pub struct ChromeControlOptions {
    url: Option<String>,
    profile: Option<String>,
    debug_port: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChromeSession {
    pub(crate) debug_port: u16,
    session_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChromeTarget {
    pub id: String,
    #[serde(rename = "type")]
    pub target_type: String,
    pub title: String,
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub websocket_debugger_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CDPMessage {
    id: u32,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct CDPResponse {
    id: u32,
    result: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
}

fn run_async<F, T>(future: F) -> T
where
    F: std::future::Future<Output = T>,
{
    tokio::runtime::Runtime::new().unwrap().block_on(future)
}

#[tauri::command]
pub fn chrome_debug_info(session_id: String) -> Result<String, String> {
    crate::run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        let mut debug_info = format!("Chrome Debug Info for session {}:\n", session_id);
        debug_info.push_str(&format!("Debug Port: {}\n", session.debug_port));
        debug_info.push_str(&format!("Port in use: {}\n", is_port_in_use(session.debug_port)));

        match check_chrome_devtools(session.debug_port).await {
            Ok(targets) => {
                debug_info.push_str(&format!("DevTools API: Responsive\n"));
                debug_info.push_str(&format!("Targets found: {}\n\n", targets.len()));

                for (i, target) in targets.iter().enumerate() {
                    debug_info.push_str(&format!("Target {}:\n", i + 1));
                    debug_info.push_str(&format!("  ID: {}\n", target.id));
                    debug_info.push_str(&format!("  Type: {}\n", target.target_type));
                    debug_info.push_str(&format!("  Title: {}\n", target.title));
                    debug_info.push_str(&format!("  URL: {}\n", target.url));
                    debug_info.push_str(&format!("  WebSocket: {}\n", target.websocket_debugger_url));
                    debug_info.push_str("\n");
                }

                // Test connection to a target
                if let Some(target) = targets.iter().find(|t| t.target_type == "page" && !t.url.starts_with("chrome-extension://")) {
                    debug_info.push_str(&format!("Testing WebSocket connection to target: {}\n", target.id));

                    let test_params = serde_json::json!({
                        "expression": "navigator.userAgent",
                        "returnByValue": true
                    });

                    match send_cdp_message(&target.websocket_debugger_url, "Runtime.evaluate", test_params).await {
                        Ok(_) => {
                            debug_info.push_str("✅ WebSocket connection test successful\n");
                        }
                        Err(e) => {
                            debug_info.push_str(&format!("❌ WebSocket connection test failed: {}\n", e));
                        }
                    }
                }
            }
            Err(e) => {
                debug_info.push_str(&format!("DevTools API: Error - {}\n", e));
            }
        }

        Ok(debug_info)
    })
}

#[tauri::command]
pub fn chrome_get_targets(session_id: String) -> Result<Vec<ChromeTarget>, String> {
    crate::run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        match check_chrome_devtools(session.debug_port).await {
            Ok(targets) => Ok(targets),
            Err(e) => Err(format!("Failed to get Chrome targets: {}", e)),
        }
    })
}

#[tauri::command]
pub fn chrome_execute_script(session_id: String, script: String) -> Result<String, String> {
    crate::run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        println!("Executing script on session port {}: {}", session.debug_port, script);

        // Get current targets
        let targets = match check_chrome_devtools(session.debug_port).await {
            Ok(targets) => {
                println!("Chrome DevTools responsive, found {} targets", targets.len());
                targets
            }
            Err(e) => {
                return Err(format!("Chrome session is no longer responsive: {}", e));
            }
        };

        // Find the best target to execute script on (prefer pages over background pages)
        let target = targets.iter()
            .find(|t| t.target_type == "page" && !t.url.starts_with("chrome-extension://"))
            .or_else(|| targets.iter().find(|t| t.target_type == "page"))
            .or_else(|| targets.first())
            .ok_or("No suitable target found for script execution")?;

        println!("Executing script on target: {} - {}", target.title, target.url);

        let params = serde_json::json!({
            "expression": script,
            "returnByValue": true
        });

        match send_cdp_message(&target.websocket_debugger_url, "Runtime.evaluate", params).await {
            Ok(result) => {
                // Parse the result
                if let Some(value) = result.get("value") {
                    Ok(value.to_string())
                } else if let Some(result_obj) = result.get("result") {
                    if let Some(value) = result_obj.get("value") {
                        Ok(value.to_string())
                    } else {
                        Ok(result_obj.to_string())
                    }
                } else {
                    Ok(result.to_string())
                }
            }
            Err(e) => Err(format!("Script execution failed: {}", e)),
        }
    })
}

#[tauri::command]
pub fn open_chrome_with_control(options: ChromeControlOptions) -> Result<ChromeSession, String> {
    run_async(async move {
        let requested_port = options.debug_port.unwrap_or(9222);
        let session_id = uuid::Uuid::new_v4().to_string();

        println!("Attempting to open Chrome with control on port {}", requested_port);

        // First, check if Chrome is already running and responsive on the requested port
        if is_port_in_use(requested_port) {
            println!("Port {} is in use, checking if Chrome DevTools is responding...", requested_port);

            match check_chrome_devtools(requested_port).await {
                Ok(targets) => {
                    println!("Found existing Chrome with {} targets", targets.len());

                    let session = ChromeSession {
                        debug_port: requested_port,
                        session_id: session_id.clone(),
                    };
                    get_chrome_sessions().insert(session_id.clone(), session.clone());
                    return Ok(session);
                }
                Err(e) => {
                    println!("Port is in use but Chrome DevTools not responding: {}", e);
                    // Port is in use by something else, find different port
                }
            }
        }

        // Find an available port for new Chrome instance
        let available_port = if is_port_in_use(requested_port) {
            let new_port = find_available_port(requested_port + 1);
            println!("Port {} in use, using port {} instead", requested_port, new_port);
            new_port
        } else {
            println!("Port {} is available", requested_port);
            requested_port
        };

        // Launch new Chrome instance
        println!("Launching new Chrome instance...");
        match launch_new_chrome(&options, available_port).await {
            Ok(_) => {
                println!("Chrome launched, waiting for startup...");

                // Wait longer for Chrome to fully start up
                for i in 1..=10 {
                    sleep(Duration::from_secs(1)).await;
                    println!("Startup check {}/10...", i);

                    if is_port_in_use(available_port) {
                        // Check if DevTools API is responding
                        match check_chrome_devtools(available_port).await {
                            Ok(targets) => {
                                println!("Chrome DevTools is responsive with {} targets", targets.len());

                                let session = ChromeSession {
                                    debug_port: available_port,
                                    session_id: session_id.clone(),
                                };
                                get_chrome_sessions().insert(session_id.clone(), session.clone());
                                return Ok(session);
                            }
                            Err(e) => {
                                println!("DevTools check {}/10 failed: {}", i, e);
                                if i == 10 {
                                    return Err(format!("Chrome launched but DevTools API not responding: {}", e));
                                }
                            }
                        }
                    }
                }

                Err("Chrome startup timeout".to_string())
            }
            Err(e) => Err(format!("Failed to launch Chrome: {}", e)),
        }
    })
}

// Check if a port is in use
fn is_port_in_use(port: u16) -> bool {
    match TcpStream::connect(format!("127.0.0.1:{}", port)) {
        Ok(_) => true,
        Err(_) => false,
    }
}

// Find an available port starting from the given port
fn find_available_port(start_port: u16) -> u16 {
    for port in start_port..start_port + 100 {
        if !is_port_in_use(port) {
            return port;
        }
    }
    start_port // Fallback to original port if none found
}

// Check if Chrome DevTools is responding on the given port
pub async fn check_chrome_devtools(debug_port: u16) -> Result<Vec<ChromeTarget>, String> {
    let url = format!("http://127.0.0.1:{}/json", debug_port);

    match reqwest::get(&url).await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<Vec<ChromeTarget>>().await {
                    Ok(targets) => Ok(targets),
                    Err(e) => Err(format!("Failed to parse Chrome targets: {}", e)),
                }
            } else {
                Err(format!("Chrome DevTools HTTP API returned status: {}", response.status()))
            }
        }
        Err(e) => Err(format!("Failed to connect to Chrome DevTools HTTP API: {}", e)),
    }
}

// Send CDP message and wait for response
pub async fn send_cdp_message(websocket_url: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let message_id = get_next_message_id();

    let cdp_message = CDPMessage {
        id: message_id,
        method: method.to_string(),
        params,
    };

    let message_json = serde_json::to_string(&cdp_message)
        .map_err(|e| format!("Failed to serialize CDP message: {}", e))?;

    println!("Connecting to WebSocket: {}", websocket_url);
    println!("Sending CDP message: {}", message_json);

    let (ws_stream, _) = connect_async(websocket_url).await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Send the message
    write.send(Message::Text(message_json)).await
        .map_err(|e| format!("Failed to send message: {}", e))?;

    // Wait for response with timeout
    let response = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    println!("Received response: {}", text);

                    if let Ok(cdp_response) = serde_json::from_str::<CDPResponse>(&text) {
                        if cdp_response.id == message_id {
                            if let Some(error) = cdp_response.error {
                                return Err(format!("CDP Error: {}", error));
                            }
                            return Ok(cdp_response.result.unwrap_or(serde_json::Value::Null));
                        }
                    }
                }
                Ok(_) => continue,
                Err(e) => return Err(format!("WebSocket error: {}", e)),
            }
        }
        Err("No response received".to_string())
    }).await;

    match response {
        Ok(result) => result,
        Err(_) => Err("Request timeout".to_string()),
    }
}

async fn launch_new_chrome(options: &ChromeControlOptions, debug_port: u16) -> Result<(), String> {
    println!("Launching new Chrome instance on port {}", debug_port);

    // Build Chrome command with remote debugging
    let mut args = vec![
        format!("--remote-debugging-port={}", debug_port),
        "--disable-web-security".to_string(),
        "--disable-features=VizDisplayCompositor".to_string(),
        "--no-first-run".to_string(),
        "--disable-default-apps".to_string(),
        "--no-default-browser-check".to_string(),
    ];

    // Add profile if specified
    if let Some(profile) = &options.profile {
        if profile != "Default" {
            args.push(format!("--profile-directory={}", profile));
        }
    }

    // Add URL if specified, otherwise start with blank page
    if let Some(url) = &options.url {
        args.push(url.clone());
    } else {
        args.push("about:blank".to_string());
    }

    println!("Chrome launch args: {:?}", args);

    let result = {
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", "start", "", "chrome"])
                .args(&args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        }

        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .args(["-a", "Google Chrome", "--args"])
                .args(&args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        }

        #[cfg(target_os = "linux")]
        {
            Command::new("google-chrome")
                .args(&args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .or_else(|_| {
                    Command::new("chromium-browser")
                        .args(&args)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                })
                .or_else(|_| {
                    Command::new("chromium")
                        .args(&args)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                })
        }
    };

    match result {
        Ok(_) => {
            println!("Chrome process spawned successfully");
            Ok(())
        },
        Err(e) => Err(format!("Failed to spawn Chrome process: {}", e)),
    }
}