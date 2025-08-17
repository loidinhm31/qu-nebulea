use serde::{Deserialize, Serialize};
use crate::chromium::lib::{check_chrome_devtools, send_cdp_message};
use crate::{get_chrome_sessions, run_async};

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

// Function to generate element interaction script
fn generate_element_action_script(action: &ElementAction) -> String {
    format!(
        r#"
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
"#,
        action.hint, action.hint, action.hint, action.action_type
    )
}
