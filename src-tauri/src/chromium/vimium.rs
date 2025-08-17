use crate::chromium::lib::{check_chrome_devtools, send_cdp_message};
use crate::chromium::vimium_script::{
    generate_element_action_script, VIMIUM_CLEANUP_SCRIPT, VIMIUM_SCRIPT,
};
use crate::{get_chrome_sessions, run_async};
use serde::{Deserialize, Serialize};

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
    pub action_type: String, // "click", "hover", "focus", "right_click", "fill", "set_value"
    pub modifier_keys: Option<Vec<String>>, // "ctrl", "shift", "alt", "meta"
    pub value: Option<String>, // For fill/set_value operations
}

#[tauri::command]
pub fn chrome_show_page_hints(session_id: String) -> Result<PageHints, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions
            .get(&session_id)
            .ok_or("Session not found")?
            .clone();

        // Get current targets
        let targets = check_chrome_devtools(session.debug_port)
            .await
            .map_err(|e| format!("Chrome session is no longer responsive: {}", e))?;

        // Find the best target to execute script on
        let target = targets
            .iter()
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
                        Err(e) => Err(format!(
                            "Failed to parse page hints: {} - Raw result: {}",
                            e, value
                        )),
                    }
                } else if let Some(result_obj) = result.get("result") {
                    if let Some(value) = result_obj.get("value") {
                        match serde_json::from_value::<PageHints>(value.clone()) {
                            Ok(page_hints) => Ok(page_hints),
                            Err(e) => Err(format!(
                                "Failed to parse page hints from result: {} - Raw result: {}",
                                e, value
                            )),
                        }
                    } else {
                        Err(format!("No value in result object: {}", result_obj))
                    }
                } else {
                    Err(format!("Unexpected result format: {}", result))
                }
            }
            Err(e) => Err(format!("Script execution failed: {}", e)),
        }
    })
}

#[tauri::command]
pub fn chrome_clear_page_hints(session_id: String) -> Result<String, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions
            .get(&session_id)
            .ok_or("Session not found")?
            .clone();

        let targets = check_chrome_devtools(session.debug_port)
            .await
            .map_err(|e| format!("Chrome session is no longer responsive: {}", e))?;

        let target = targets
            .iter()
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
            Err(e) => Err(format!("Failed to clear hints: {}", e)),
        }
    })
}

#[tauri::command]
pub fn chrome_interact_with_element(
    session_id: String,
    action: ElementAction,
) -> Result<String, String> {
    run_async(async move {
        let sessions = get_chrome_sessions();
        let session = sessions
            .get(&session_id)
            .ok_or("Session not found")?
            .clone();

        let targets = check_chrome_devtools(session.debug_port)
            .await
            .map_err(|e| format!("Chrome session is no longer responsive: {}", e))?;

        let target = targets
            .iter()
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
            Err(e) => Err(format!("Element interaction failed: {}", e)),
        }
    })
}
