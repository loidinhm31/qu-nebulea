use std::process::Command;
use serde::{Deserialize, Serialize};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            parse_command,
            execute_os_command,
            open_file_dialog,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}