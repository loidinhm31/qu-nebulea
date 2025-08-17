use std::process::{Command, Stdio};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tokio::time::sleep;
use std::collections::HashMap;
use std::net::TcpStream;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResponse {
    success: bool,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedCommand {
    action: String,
    target: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChromeControlOptions {
    url: Option<String>,
    profile: Option<String>,
    debug_port: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChromeSession {
    debug_port: u16,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageElement {
    pub hint: String,
    pub tag_name: String,
    pub element_type: String,
    pub text: String,
    pub href: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub selector: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageHints {
    pub elements: Vec<PageElement>,
    pub total_count: usize,
    pub visible_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ElementAction {
    pub hint: String,
    pub action_type: String, // "click", "hover", "focus", "right_click"
    pub modifier_keys: Option<Vec<String>>, // "ctrl", "shift", "alt", "meta"
}

// Global state to track Chrome sessions
static mut CHROME_SESSIONS: Option<HashMap<String, ChromeSession>> = None;
static mut MESSAGE_ID_COUNTER: u32 = 1;

fn get_chrome_sessions() -> &'static mut HashMap<String, ChromeSession> {
    unsafe {
        if CHROME_SESSIONS.is_none() {
            CHROME_SESSIONS = Some(HashMap::new());
        }
        CHROME_SESSIONS.as_mut().unwrap()
    }
}

fn get_next_message_id() -> u32 {
    unsafe {
        let id = MESSAGE_ID_COUNTER;
        MESSAGE_ID_COUNTER += 1;
        id
    }
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
async fn check_chrome_devtools(debug_port: u16) -> Result<Vec<ChromeTarget>, String> {
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
async fn send_cdp_message(websocket_url: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn parse_command(input: &str) -> Result<ParsedCommand, String> {
    let parts: Vec<&str> = input.trim().split_whitespace().collect();

    if parts.len() < 2 {
        return Err("Command must have at least action and target (e.g., 'Open Chrome')".to_string());
    }

    let action = parts[0].to_lowercase();
    let target = parts[1..].join(" ").to_lowercase();

    Ok(ParsedCommand { action, target })
}

#[tauri::command]
fn execute_os_command(parsed_command: ParsedCommand) -> CommandResponse {
    match parsed_command.action.as_str() {
        "open" => open_application(&parsed_command.target),
        _ => CommandResponse {
            success: false,
            message: format!("Unknown action: {}", parsed_command.action),
        },
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

#[tauri::command]
fn open_chrome_with_control(options: ChromeControlOptions) -> Result<ChromeSession, String> {
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

#[tauri::command]
fn chrome_execute_script(session_id: String, script: String) -> Result<String, String> {
    run_async(async move {
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
fn chrome_get_profiles() -> Result<Vec<String>, String> {
    // This is a simplified implementation
    // In a real app, you'd scan the Chrome user data directory
    let common_profiles = vec![
        "Default".to_string(),
        "Profile 1".to_string(),
        "Profile 2".to_string(),
        "Profile 3".to_string(),
    ];

    Ok(common_profiles)
}

#[tauri::command]
fn chrome_debug_info(session_id: String) -> Result<String, String> {
    run_async(async move {
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
fn chrome_get_targets(session_id: String) -> Result<Vec<ChromeTarget>, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        match check_chrome_devtools(session.debug_port).await {
            Ok(targets) => Ok(targets),
            Err(e) => Err(format!("Failed to get Chrome targets: {}", e)),
        }
    })
}

// Helper function to run async code in Tauri commands
fn run_async<F, T>(future: F) -> T
where
    F: std::future::Future<Output = T>,
{
    tokio::runtime::Runtime::new().unwrap().block_on(future)
}

fn open_application(app_name: &str) -> CommandResponse {
    let result = match app_name {
        "chrome" | "google chrome" => {
            #[cfg(target_os = "windows")]
            let cmd_result = Command::new("cmd")
                .args(["/C", "start", "chrome"])
                .output();

            #[cfg(target_os = "macos")]
            let cmd_result = Command::new("open")
                .args(["-a", "Google Chrome"])
                .output();

            #[cfg(target_os = "linux")]
            let cmd_result = Command::new("google-chrome")
                .output()
                .or_else(|_| Command::new("chromium-browser").output())
                .or_else(|_| Command::new("chromium").output());

            cmd_result
        },
        "firefox" => {
            #[cfg(target_os = "windows")]
            let cmd_result = Command::new("cmd")
                .args(["/C", "start", "firefox"])
                .output();

            #[cfg(target_os = "macos")]
            let cmd_result = Command::new("open")
                .args(["-a", "Firefox"])
                .output();

            #[cfg(target_os = "linux")]
            let cmd_result = Command::new("firefox")
                .output();

            cmd_result
        },
        "notepad" => {
            #[cfg(target_os = "windows")]
            let cmd_result = Command::new("notepad")
                .output();

            #[cfg(target_os = "macos")]
            let cmd_result = Command::new("open")
                .args(["-a", "TextEdit"])
                .output();

            #[cfg(target_os = "linux")]
            let cmd_result = Command::new("gedit")
                .output()
                .or_else(|_| Command::new("nano").output());

            cmd_result
        },
        "file manager" | "explorer" | "finder" => {
            #[cfg(target_os = "windows")]
            let cmd_result = Command::new("explorer")
                .output();

            #[cfg(target_os = "macos")]
            let cmd_result = Command::new("open")
                .args(["-a", "Finder"])
                .output();

            #[cfg(target_os = "linux")]
            let cmd_result = Command::new("nautilus")
                .output()
                .or_else(|_| Command::new("dolphin").output())
                .or_else(|_| Command::new("thunar").output());

            cmd_result
        },
        _ => {
            return CommandResponse {
                success: false,
                message: format!("Application '{}' is not supported yet", app_name),
            };
        }
    };

    match result {
        Ok(_) => CommandResponse {
            success: true,
            message: format!("Successfully opened {}", app_name),
        },
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to open {}: {}", app_name, e),
        },
    }
}

#[tauri::command]
fn open_file_dialog() -> Result<String, String> {
    // This will be enhanced later for file/folder operations
    Ok("File dialog functionality coming soon".to_string())
}

#[tauri::command]
fn open_folder(path: &str) -> CommandResponse {
    let result = {
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg(path)
                .output()
        }

        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(path)
                .output()
        }

        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open")
                .arg(path)
                .output()
        }
    };

    match result {
        Ok(_) => CommandResponse {
            success: true,
            message: format!("Successfully opened folder: {}", path),
        },
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to open folder {}: {}", path, e),
        },
    }
}

// JavaScript code to inject for finding and highlighting elements
const VIMIUM_SCRIPT: &str = r#"
(function() {
    // Remove existing hints if any
    const existingHints = document.querySelectorAll('.vimium-hint, .vimium-hint-overlay');
    existingHints.forEach(el => el.remove());

    // Generate hint labels (a-z, aa-zz, etc.)
    function generateHints(count) {
        const chars = 'abcdefghijklmnopqrstuvwxyz';
        const hints = [];

        if (count <= 26) {
            for (let i = 0; i < count; i++) {
                hints.push(chars[i]);
            }
        } else {
            for (let i = 0; i < 26; i++) {
                hints.push(chars[i]);
            }
            let remaining = count - 26;
            for (let i = 0; i < 26 && remaining > 0; i++) {
                for (let j = 0; j < 26 && remaining > 0; j++) {
                    hints.push(chars[i] + chars[j]);
                    remaining--;
                }
            }
        }

        return hints.slice(0, count);
    }

    // Check if element is visible and interactable
    function isElementVisible(el) {
        if (!el || el.offsetParent === null) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (rect.top < 0 && rect.bottom < 0) return false;
        if (rect.left < 0 && rect.right < 0) return false;
        if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        return true;
    }

    // Find all clickable elements
    const selectors = [
        'a[href]',
        'button:not([disabled])',
        'input[type="button"]:not([disabled])',
        'input[type="submit"]:not([disabled])',
        'input[type="reset"]:not([disabled])',
        'input[type="checkbox"]:not([disabled])',
        'input[type="radio"]:not([disabled])',
        'input[type="file"]:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'input[type="text"]:not([disabled])',
        'input[type="email"]:not([disabled])',
        'input[type="password"]:not([disabled])',
        'input[type="number"]:not([disabled])',
        'input[type="search"]:not([disabled])',
        'input[type="url"]:not([disabled])',
        'input[type="tel"]:not([disabled])',
        '[contenteditable="true"]',
        '[onclick]',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[tabindex]:not([tabindex="-1"])'
    ];

    let elements = [];

    selectors.forEach(selector => {
        const found = document.querySelectorAll(selector);
        found.forEach(el => {
            if (isElementVisible(el) && !elements.includes(el)) {
                elements.push(el);
            }
        });
    });

    // Generate hints for all elements
    const hints = generateHints(elements.length);
    const pageElements = [];

    // Create hint overlays and collect element data
    elements.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const hint = hints[index];

        // Create hint overlay
        const hintOverlay = document.createElement('div');
        hintOverlay.className = 'vimium-hint-overlay';
        hintOverlay.innerHTML = `<span class="vimium-hint">${hint}</span>`;

        // Style the hint overlay
        hintOverlay.style.cssText = `
            position: fixed !important;
            top: ${rect.top + window.scrollY - 2}px !important;
            left: ${rect.left + window.scrollX - 2}px !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            font-family: monospace !important;
            font-size: 11px !important;
            line-height: 1 !important;
        `;

        hintOverlay.querySelector('.vimium-hint').style.cssText = `
            background: linear-gradient(135deg, #ff6b35, #f7931e) !important;
            color: white !important;
            padding: 2px 4px !important;
            border-radius: 2px !important;
            font-weight: bold !important;
            text-shadow: 0 1px 1px rgba(0,0,0,0.3) !important;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            border: 1px solid rgba(255,255,255,0.2) !important;
            display: inline-block !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
        `;

        document.body.appendChild(hintOverlay);

        // Generate unique selector for the element
        function generateSelector(element) {
            if (element.id) return `#${element.id}`;

            let selector = element.tagName.toLowerCase();
            if (element.className) {
                selector += '.' + element.className.trim().split(/\s+/).join('.');
            }

            // Add nth-child if needed for uniqueness
            const parent = element.parentNode;
            if (parent) {
                const siblings = Array.from(parent.children).filter(el =>
                    el.tagName === element.tagName && el.className === element.className
                );
                if (siblings.length > 1) {
                    const index = siblings.indexOf(element) + 1;
                    selector += `:nth-child(${index})`;
                }
            }

            return selector;
        }

        // Collect element data
        pageElements.push({
            hint: hint,
            tag_name: el.tagName.toLowerCase(),
            element_type: el.type || 'none',
            text: (el.textContent || el.value || el.alt || el.title || '').trim().substring(0, 100),
            href: el.href || null,
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
            visible: true,
            selector: generateSelector(el)
        });
    });

    // Store elements mapping for later use
    window.vimiumElements = elements;
    window.vimiumHints = hints;

    return {
        elements: pageElements,
        total_count: elements.length,
        visible_count: pageElements.filter(el => el.visible).length
    };
})();
"#;

const VIMIUM_CLEANUP_SCRIPT: &str = r#"
(function() {
    // Remove all hint overlays
    const existingHints = document.querySelectorAll('.vimium-hint, .vimium-hint-overlay');
    existingHints.forEach(el => el.remove());

    // Clean up global variables
    delete window.vimiumElements;
    delete window.vimiumHints;

    return { success: true, message: "Vimium hints cleared" };
})();
"#;

// Function to generate element interaction script
fn generate_element_action_script(action: &ElementAction) -> String {
    format!(r#"
(function() {{
    if (!window.vimiumElements || !window.vimiumHints) {{
        return {{ success: false, message: "No vimium elements found. Please refresh hints first." }};
    }}

    const hintIndex = window.vimiumHints.indexOf('{}');
    if (hintIndex === -1) {{
        return {{ success: false, message: "Hint '{}' not found" }};
    }}

    const element = window.vimiumElements[hintIndex];
    if (!element) {{
        return {{ success: false, message: "Element not found for hint '{}'" }};
    }}

    // Scroll element into view if needed
    element.scrollIntoView({{ behavior: 'smooth', block: 'center' }});

    // Create and dispatch the appropriate event
    let event;
    const actionType = '{}';

    try {{
        switch (actionType) {{
            case 'click':
                // Simulate mouse click with proper event sequence
                const clickEvents = ['mousedown', 'mouseup', 'click'];
                clickEvents.forEach(eventType => {{
                    const mouseEvent = new MouseEvent(eventType, {{
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        button: 0,
                        buttons: 1,
                        clientX: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
                        clientY: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
                    }});
                    element.dispatchEvent(mouseEvent);
                }});

                // For form elements, also trigger change/input events
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {{
                    element.focus();
                    element.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    element.dispatchEvent(new Event('input', {{ bubbles: true }}));
                }}
                break;

            case 'right_click':
                event = new MouseEvent('contextmenu', {{
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 2,
                    buttons: 2
                }});
                element.dispatchEvent(event);
                break;

            case 'hover':
                event = new MouseEvent('mouseover', {{
                    bubbles: true,
                    cancelable: true,
                    view: window
                }});
                element.dispatchEvent(event);
                break;

            case 'focus':
                if (element.focus) {{
                    element.focus();
                }} else {{
                    return {{ success: false, message: "Element cannot be focused" }};
                }}
                break;

            default:
                return {{ success: false, message: "Unknown action type: " + actionType }};
        }}

        return {{
            success: true,
            message: `${{actionType}} action performed on ${{element.tagName}} element`,
            element_info: {{
                tag: element.tagName,
                text: (element.textContent || element.value || '').substring(0, 50),
                href: element.href || null,
                id: element.id || null,
                className: element.className || null
            }}
        }};

    }} catch (error) {{
        return {{
            success: false,
            message: "Error performing action: " + error.message
        }};
    }}
}})();
"#, action.hint, action.hint, action.hint, action.action_type)
}

// New Tauri commands for Vimium functionality
#[tauri::command]
fn chrome_show_page_hints(session_id: String) -> Result<PageHints, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        // Get current targets
        let targets = check_chrome_devtools(session.debug_port).await
            .map_err(|e| format!("Chrome session is no longer responsive: {}", e))?;

        // Find the best target to execute script on
        let target = targets.iter()
            .find(|t| t.target_type == "page" && !t.url.starts_with("chrome-extension://"))
            .or_else(|| targets.iter().find(|t| t.target_type == "page"))
            .or_else(|| targets.first())
            .ok_or("No suitable target found for script execution")?;

        let params = serde_json::json!({
            "expression": VIMIUM_SCRIPT,
            "returnByValue": true
        });

        match send_cdp_message(&target.websocket_debugger_url, "Runtime.evaluate", params).await {
            Ok(result) => {
                if let Some(value) = result.get("value") {
                    // Try to parse the result as PageHints
                    match serde_json::from_value::<PageHints>(value.clone()) {
                        Ok(page_hints) => Ok(page_hints),
                        Err(e) => Err(format!("Failed to parse page hints: {} - Raw result: {}", e, value))
                    }
                } else if let Some(result_obj) = result.get("result") {
                    if let Some(value) = result_obj.get("value") {
                        match serde_json::from_value::<PageHints>(value.clone()) {
                            Ok(page_hints) => Ok(page_hints),
                            Err(e) => Err(format!("Failed to parse page hints from result: {} - Raw result: {}", e, value))
                        }
                    } else {
                        Err(format!("No value in result object: {}", result_obj))
                    }
                } else {
                    Err(format!("Unexpected result format: {}", result))
                }
            }
            Err(e) => Err(format!("Script execution failed: {}", e))
        }
    })
}

#[tauri::command]
fn chrome_clear_page_hints(session_id: String) -> Result<String, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        let targets = check_chrome_devtools(session.debug_port).await
            .map_err(|e| format!("Chrome session is no longer responsive: {}", e))?;

        let target = targets.iter()
            .find(|t| t.target_type == "page" && !t.url.starts_with("chrome-extension://"))
            .or_else(|| targets.iter().find(|t| t.target_type == "page"))
            .or_else(|| targets.first())
            .ok_or("No suitable target found")?;

        let params = serde_json::json!({
            "expression": VIMIUM_CLEANUP_SCRIPT,
            "returnByValue": true
        });

        match send_cdp_message(&target.websocket_debugger_url, "Runtime.evaluate", params).await {
            Ok(_) => Ok("Page hints cleared successfully".to_string()),
            Err(e) => Err(format!("Failed to clear hints: {}", e))
        }
    })
}

#[tauri::command]
fn chrome_interact_with_element(session_id: String, action: ElementAction) -> Result<String, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions.get(&session_id)
            .ok_or("Session not found")?.clone();

        let targets = check_chrome_devtools(session.debug_port).await
            .map_err(|e| format!("Chrome session is no longer responsive: {}", e))?;

        let target = targets.iter()
            .find(|t| t.target_type == "page" && !t.url.starts_with("chrome-extension://"))
            .or_else(|| targets.iter().find(|t| t.target_type == "page"))
            .or_else(|| targets.first())
            .ok_or("No suitable target found")?;

        let script = generate_element_action_script(&action);
        let params = serde_json::json!({
            "expression": script,
            "returnByValue": true
        });

        match send_cdp_message(&target.websocket_debugger_url, "Runtime.evaluate", params).await {
            Ok(result) => {
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
            Err(e) => Err(format!("Element interaction failed: {}", e))
        }
    })
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            parse_command,
            execute_os_command,
            open_file_dialog,
            open_folder,
            open_chrome_with_control,
            chrome_get_profiles,
            chrome_execute_script,
            chrome_debug_info,
            chrome_get_targets,
            chrome_show_page_hints,
            chrome_clear_page_hints,
            chrome_interact_with_element
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}