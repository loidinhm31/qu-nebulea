use crate::chromium::lib::chrome_execute_script;
use crate::chromium::vimium::{chrome_clear_page_hints, chrome_interact_with_element, chrome_show_page_hints};
use crate::{execute_os_command, parse_command, run_async, CommandResponse};
use serde::{Deserialize, Serialize};

// Voice control structures
#[derive(Debug, Serialize, Deserialize)]
struct STTRequest {
    audio_data: Vec<u8>,
    language: Option<String>,
    format: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct STTResponse {
    text: String,
    confidence: Option<f32>,
}

// Configuration for your STT service
const DEFAULT_STT_ENDPOINT: &str = "http://localhost:8080/transcribe"; // Replace with your service URL

// Voice control functions
#[tauri::command]
pub async fn transcribe_audio(
    audio_data: Vec<u8>,
    voice_mode: String,
    _chrome_session_id: Option<String>, // Prefixed with _ to avoid unused warning
) -> Result<String, String> {
    if audio_data.is_empty() {
        return Err("No audio data provided".to_string());
    }

    println!("Transcribing audio: {} bytes in {} mode", audio_data.len(), voice_mode);

    // Prepare the request to your STT service
    let stt_request = STTRequest {
        audio_data,
        language: Some("en-US".to_string()), // You can make this configurable
        format: "webm_opus".to_string(),
    };

    // Send to your STT service
    match send_to_stt_service(stt_request).await {
        Ok(transcription) => {
            println!("Transcription successful: {}", transcription);
            Ok(transcription)
        }
        Err(e) => {
            println!("Transcription failed: {}", e);
            Err(format!("Speech-to-text failed: {}", e))
        }
    }
}

async fn send_to_stt_service(request: STTRequest) -> Result<String, String> {
    let client = reqwest::Client::new();

    // Create multipart form with audio data
    let form = reqwest::multipart::Form::new()
        .part("audio", reqwest::multipart::Part::bytes(request.audio_data)
            .file_name("audio.webm")
            .mime_str("audio/webm").unwrap())
        .text("language", request.language.unwrap_or_else(|| "en-US".to_string()))
        .text("format", request.format);

    let response = client
        .post(DEFAULT_STT_ENDPOINT) // Replace with your actual endpoint
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to STT service: {}", e))?;

    if response.status().is_success() {
        let stt_response: STTResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse STT response: {}", e))?;

        Ok(stt_response.text)
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!("STT service error: {}", error_text))
    }
}

#[tauri::command]
pub async fn execute_voice_command(
    command: String,
    voice_mode: String,
    chrome_session_id: Option<String>,
) -> Result<CommandResponse, String> {
    println!("Executing voice command: '{}' in mode: {}", command, voice_mode);

    let command_lower = command.to_lowercase();

    match voice_mode.as_str() {
        "chrome" => execute_chrome_voice_command(command_lower, chrome_session_id).await,
        "vimium" => execute_vimium_voice_command(command_lower, chrome_session_id).await,
        _ => execute_general_voice_command(command).await,
    }
}

async fn execute_general_voice_command(command: String) -> Result<CommandResponse, String> {
    // Try to parse as a regular command first
    match parse_command(command.as_str()) {
        Ok(parsed) => {
            // Execute the parsed command using existing OS command functionality
            Ok(execute_os_command(parsed))
        }
        Err(_) => {
            // Handle voice-specific commands
            let command_lower = command.to_lowercase();

            if command_lower.contains("switch to chrome mode") {
                Ok(CommandResponse {
                    success: true,
                    message: "Voice mode switched to Chrome (requires active Chrome session)".to_string(),
                })
            } else if command_lower.contains("switch to vimium mode") {
                Ok(CommandResponse {
                    success: true,
                    message: "Voice mode switched to Vimium (requires active Chrome session)".to_string(),
                })
            } else if command_lower.contains("switch to general mode") {
                Ok(CommandResponse {
                    success: true,
                    message: "Voice mode switched to General".to_string(),
                })
            } else {
                Err(format!("Unrecognized voice command: '{}'", command))
            }
        }
    }
}

async fn execute_chrome_voice_command(
    command: String,
    chrome_session_id: Option<String>,
) -> Result<CommandResponse, String> {
    let session_id = chrome_session_id.ok_or("No Chrome session available for Chrome voice commands")?;

    if command.contains("navigate to") || command.contains("go to") {
        // Extract URL from command
        let url = if let Some(url_start) = command.find("to ") {
            let url_part = &command[url_start + 3..].trim();
            // Add https:// if no protocol specified
            if url_part.starts_with("http://") || url_part.starts_with("https://") {
                url_part.to_string()
            } else {
                format!("https://{}", url_part)
            }
        } else {
            return Err("Could not extract URL from navigation command".to_string());
        };

        let script = format!("window.location.href = '{}'", url);

        run_async(async {
            match chrome_execute_script(session_id, script) {
                Ok(_) => Ok(CommandResponse {
                    success: true,
                    message: format!("Navigated to {}", url),
                }),
                Err(e) => Err(format!("Navigation failed: {}", e)),
            }
        })
    } else if command.contains("scroll down") {
        let script = "window.scrollBy(0, 500)".to_string();
        run_async(async {
            match chrome_execute_script(session_id, script) {
                Ok(_) => Ok(CommandResponse {
                    success: true,
                    message: "Scrolled down".to_string(),
                }),
                Err(e) => Err(format!("Scroll command failed: {}", e)),
            }
        })
    } else if command.contains("scroll up") {
        let script = "window.scrollBy(0, -500)".to_string();
        run_async(async {
            match chrome_execute_script(session_id, script) {
                Ok(_) => Ok(CommandResponse {
                    success: true,
                    message: "Scrolled up".to_string(),
                }),
                Err(e) => Err(format!("Scroll command failed: {}", e)),
            }
        })
    } else if command.contains("refresh") || command.contains("reload") {
        let script = "window.location.reload()".to_string();
        run_async(async {
            match chrome_execute_script(session_id, script) {
                Ok(_) => Ok(CommandResponse {
                    success: true,
                    message: "Page refreshed".to_string(),
                }),
                Err(e) => Err(format!("Refresh command failed: {}", e)),
            }
        })
    } else {
        Err(format!("Unrecognized Chrome voice command: '{}'", command))
    }
}

async fn execute_vimium_voice_command(
    command: String,
    chrome_session_id: Option<String>,
) -> Result<CommandResponse, String> {
    let session_id = chrome_session_id.ok_or("No Chrome session available for Vimium voice commands")?;

    if command.contains("show hints") || command.contains("show page hints") {
        run_async(async {
            match chrome_show_page_hints(session_id) {
                Ok(_) => Ok(CommandResponse {
                    success: true,
                    message: "Page hints displayed".to_string(),
                }),
                Err(e) => Err(format!("Show hints failed: {}", e)),
            }
        })
    } else if command.contains("clear hints") || command.contains("hide hints") {
        run_async(async {
            match chrome_clear_page_hints(session_id) {
                Ok(_) => Ok(CommandResponse {
                    success: true,
                    message: "Page hints cleared".to_string(),
                }),
                Err(e) => Err(format!("Clear hints failed: {}", e)),
            }
        })
    } else if command.contains("click") || command.contains("select") {
        // Extract hint letter from voice command
        if let Some(hint) = extract_hint_from_command(&command) {
            let action = crate::chromium::vimium::ElementAction {
                hint: hint.to_string(),
                action_type: "click".to_string(),
                modifier_keys: None,
                value: None,
            };

            run_async(async {
                match chrome_interact_with_element(session_id, action) {
                    Ok(_) => Ok(CommandResponse {
                        success: true,
                        message: format!("Clicked element {}", hint.to_uppercase()),
                    }),
                    Err(e) => Err(format!("Click command failed: {}", e)),
                }
            })
        } else {
            Err("Could not identify element hint in voice command. Try saying 'click A' or 'select B'".to_string())
        }
    } else if command.contains("fill") || command.contains("type") {
        // Extract hint and text to fill
        if let (Some(hint), Some(text)) = (extract_hint_from_command(&command), extract_fill_text_from_command(&command)) {
            let text_clone = text.clone(); // Clone for use in the message
            let action = crate::chromium::vimium::ElementAction {
                hint: hint.to_string(),
                action_type: "fill".to_string(),
                modifier_keys: None,
                value: Some(text),
            };

            run_async(async {
                match chrome_interact_with_element(session_id, action) {
                    Ok(_) => Ok(CommandResponse {
                        success: true,
                        message: format!("Filled element {} with '{}'", hint.to_uppercase(), text_clone),
                    }),
                    Err(e) => Err(format!("Fill command failed: {}", e)),
                }
            })
        } else {
            Err("Could not parse fill command. Try saying 'fill A with hello world'".to_string())
        }
    } else {
        Err(format!("Unrecognized Vimium voice command: '{}'", command))
    }
}

// Helper function to extract hint letter from voice command
fn extract_hint_from_command(command: &str) -> Option<char> {
    // Look for single letters in the command
    for word in command.split_whitespace() {
        if word.len() == 1 {
            let ch = word.chars().next().unwrap().to_ascii_lowercase();
            if ch.is_ascii_lowercase() {
                return Some(ch);
            }
        }
    }
    None
}

// Helper function to extract text to fill from voice command
fn extract_fill_text_from_command(command: &str) -> Option<String> {
    // Look for patterns like "fill A with text" or "type in A text"
    if let Some(with_pos) = command.find(" with ") {
        return Some(command[with_pos + 6..].trim().to_string());
    }

    // Alternative patterns - look for text after hint letter
    let words: Vec<&str> = command.split_whitespace().collect();
    for i in 0..words.len() {
        if words[i].len() == 1 && words[i].chars().next().unwrap().is_ascii_alphabetic() {
            // Found hint letter, check if there's "with" after it
            if i + 2 < words.len() && words[i + 1] == "with" {
                return Some(words[i + 2..].join(" "));
            }
            // Or just text directly after hint
            else if i + 1 < words.len() {
                return Some(words[i + 1..].join(" "));
            }
        }
    }

    None
}