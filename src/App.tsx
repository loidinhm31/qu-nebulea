import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface CommandResponse {
    success: boolean;
    message: string;
}

interface ParsedCommand {
    action: string;
    target: string;
}

function App() {
    const [command, setCommand] = useState("");
    const [result, setResult] = useState<CommandResponse | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);

    const executeCommand = async () => {
        if (!command.trim()) return;

        setIsProcessing(true);
        setResult(null);

        try {
            // First parse the command
            const parsedCommand: ParsedCommand = await invoke("parse_command", {
                input: command
            });

            console.log("Parsed command:", parsedCommand);

            // Then execute it
            const response: CommandResponse = await invoke("execute_os_command", {
                parsedCommand
            });

            setResult(response);

            // Add to history if successful
            if (response.success) {
                setCommandHistory(prev => [command, ...prev.slice(0, 9)]); // Keep last 10 commands
            }

        } catch (error) {
            setResult({
                success: false,
                message: `Error: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const executePresetCommand = async (presetCommand: string) => {
        setCommand(presetCommand);

        setIsProcessing(true);
        setResult(null);

        try {
            const parsedCommand: ParsedCommand = await invoke("parse_command", {
                input: presetCommand
            });

            const response: CommandResponse = await invoke("execute_os_command", {
                parsedCommand
            });

            setResult(response);

            if (response.success) {
                setCommandHistory(prev => [presetCommand, ...prev.slice(0, 9)]);
            }

        } catch (error) {
            setResult({
                success: false,
                message: `Error: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const openFolder = async (path: string) => {
        setIsProcessing(true);
        try {
            const response: CommandResponse = await invoke("open_folder", { path });
            setResult(response);
        } catch (error) {
            setResult({
                success: false,
                message: `Error opening folder: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <main className="min-h-screen p-4 lg:p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="text-center space-y-4">
                    <h1 className="text-4xl lg:text-5xl font-bold gradient-text">
                        OS Control Center
                    </h1>
                    <p className="text-xl text-gray-600 dark:text-gray-400">
                        Control your system with natural language commands
                    </p>
                </div>

                {/* Command Input Section */}
                <div className="card p-6 lg:p-8">
                    <form
                        className="flex flex-col lg:flex-row gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            executeCommand();
                        }}
                    >
                        <input
                            className="input-primary flex-1"
                            value={command}
                            onChange={(e) => setCommand(e.currentTarget.value)}
                            placeholder="Enter command (e.g., 'Open Chrome', 'Open Firefox')"
                            disabled={isProcessing}
                        />
                        <button
                            type="submit"
                            disabled={isProcessing || !command.trim()}
                            className="btn-primary min-w-[140px]"
                        >
                            {isProcessing ? (
                                <div className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Processing...
                                </div>
                            ) : (
                                "Execute"
                            )}
                        </button>
                    </form>
                </div>

                {/* Preset Commands */}
                <div className="card p-6">
                    <h3 className="text-xl font-semibold mb-6 text-gray-800 dark:text-gray-200">
                        Quick Actions
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <button
                            onClick={() => executePresetCommand("Open Chrome")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-red-500 to-yellow-500 rounded-full"></div>
                            Open Chrome
                        </button>
                        <button
                            onClick={() => executePresetCommand("Open Firefox")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-orange-500 to-red-500 rounded-full"></div>
                            Open Firefox
                        </button>
                        <button
                            onClick={() => executePresetCommand("Open Notepad")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"></div>
                            Open Notepad
                        </button>
                        <button
                            onClick={() => executePresetCommand("Open Explorer")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-green-500 to-green-600 rounded-full"></div>
                            File Manager
                        </button>
                    </div>
                </div>

                {/* Folder Quick Access */}
                <div className="card p-6">
                    <h3 className="text-xl font-semibold mb-6 text-gray-800 dark:text-gray-200">
                        Open Folders
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button
                            onClick={() => openFolder(".")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></div>
                            Current Directory
                        </button>
                        <button
                            onClick={() => openFolder(navigator.platform.includes("Win") ? "C:\\" : "/")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"></div>
                            Root Directory
                        </button>
                        <button
                            onClick={() => openFolder(navigator.platform.includes("Win") ? "%USERPROFILE%" : "~")}
                            disabled={isProcessing}
                            className="btn-secondary flex items-center justify-center gap-2 p-4"
                        >
                            <div className="w-5 h-5 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-full"></div>
                            Home Directory
                        </button>
                    </div>
                </div>

                {/* Result Display */}
                {result && (
                    <div className={result.success ? 'alert-success' : 'alert-error'}>
                        <div className="flex items-start gap-3">
                            <div className="text-2xl">
                                {result.success ? "✅" : "❌"}
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg mb-1">
                                    {result.success ? "Success" : "Error"}
                                </h3>
                                <p className="text-sm opacity-90">{result.message}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Command History */}
                {commandHistory.length > 0 && (
                    <div className="card p-6">
                        <h3 className="text-xl font-semibold mb-6 text-gray-800 dark:text-gray-200">
                            Recent Commands
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {commandHistory.map((cmd, index) => (
                                <button
                                    key={index}
                                    onClick={() => setCommand(cmd)}
                                    className="history-item"
                                    disabled={isProcessing}
                                >
                                    {cmd}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Help Section */}
                <div className="card p-6 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 border-2 border-dashed border-gray-300 dark:border-gray-600">
                    <h3 className="text-xl font-semibold mb-6 text-gray-800 dark:text-gray-200">
                        Supported Commands
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                                <code className="bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 px-2 py-1 rounded text-sm font-mono">
                                    Open Chrome
                                </code>
                                <span className="text-gray-600 dark:text-gray-400 text-sm">
                  Opens Google Chrome browser
                </span>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                                <code className="bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 px-2 py-1 rounded text-sm font-mono">
                                    Open Firefox
                                </code>
                                <span className="text-gray-600 dark:text-gray-400 text-sm">
                  Opens Firefox browser
                </span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                                <code className="bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 px-2 py-1 rounded text-sm font-mono">
                                    Open Notepad
                                </code>
                                <span className="text-gray-600 dark:text-gray-400 text-sm">
                  Opens text editor
                </span>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                                <code className="bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 px-2 py-1 rounded text-sm font-mono">
                                    Open Explorer
                                </code>
                                <span className="text-gray-600 dark:text-gray-400 text-sm">
                  Opens file manager
                </span>
                            </div>
                        </div>
                    </div>
                    <div className="text-center p-4 bg-gradient-to-r from-primary-50 to-secondary-50 dark:from-primary-900/20 dark:to-secondary-900/20 rounded-lg border border-primary-200 dark:border-primary-700">
                        <p className="text-primary-700 dark:text-primary-300 font-medium">
                            🚀 More applications and features coming soon, including Chromium DOM interaction!
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}

export default App;