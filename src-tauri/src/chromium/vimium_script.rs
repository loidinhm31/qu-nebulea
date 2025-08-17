use crate::chromium::vimium::ElementAction;

// JavaScript code to inject for finding and highlighting elements
pub const VIMIUM_SCRIPT: &str = r#"
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

pub const VIMIUM_CLEANUP_SCRIPT: &str = r#"
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
pub fn generate_element_action_script(action: &ElementAction) -> String {
    let escaped_value = action.value.as_ref().map(|v| {
        v.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }).unwrap_or_default();

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
    const fillValue = "{}";

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

            case 'fill':
            case 'set_value':
                // Check if element supports value setting
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {{
                    // Focus the element first
                    element.focus();

                    // Clear existing value
                    element.value = '';

                    // Set new value
                    element.value = fillValue;

                    // Trigger input events to notify frameworks (React, Vue, etc.)
                    element.dispatchEvent(new Event('input', {{ bubbles: true, cancelable: true }}));
                    element.dispatchEvent(new Event('change', {{ bubbles: true, cancelable: true }}));

                    // For React specifically, also trigger a more comprehensive event
                    const inputEvent = new InputEvent('input', {{
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: fillValue
                    }});
                    element.dispatchEvent(inputEvent);

                    return {{
                        success: true,
                        message: `Filled ${{element.tagName}} with "${{fillValue}}"`,
                        element_info: {{
                            tag: element.tagName,
                            type: element.type || 'text',
                            value: element.value,
                            id: element.id || null,
                            name: element.name || null,
                            className: element.className || null
                        }}
                    }};
                }} else if (element.contentEditable === 'true' || element.contentEditable === '') {{
                    // Handle contenteditable elements
                    element.focus();

                    // Clear existing content
                    element.innerHTML = '';

                    // Set new content
                    element.textContent = fillValue;

                    // Trigger input events
                    element.dispatchEvent(new Event('input', {{ bubbles: true, cancelable: true }}));
                    element.dispatchEvent(new Event('change', {{ bubbles: true, cancelable: true }}));

                    return {{
                        success: true,
                        message: `Filled contenteditable element with "${{fillValue}}"`,
                        element_info: {{
                            tag: element.tagName,
                            text: element.textContent,
                            id: element.id || null,
                            className: element.className || null
                        }}
                    }};
                }} else {{
                    return {{
                        success: false,
                        message: `Element ${{element.tagName}} does not support text input. Only INPUT, TEXTAREA, and contenteditable elements can be filled.`
                    }};
                }}

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
        action.hint, action.hint, action.hint, action.action_type, escaped_value
    )
}