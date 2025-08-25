import {useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import "./App.css";
import {ChromeSession, CommandResponse, ParsedCommand} from "./types/Control.tsx";
import PresetCommands from "./components/PresetCommands.tsx";
import ChromeControl from "./components/ChromeControl.tsx";
import VoiceControl from "./components/VoiceControl.tsx";


function App() {
    const [command, setCommand] = useState("");
    const [result, setResult] = useState<CommandResponse | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [chromeSession, setChromeSession] = useState<ChromeSession | null>(null);

    const executeCommand = async () => {
        if (!command.trim()) return;

        setIsProcessing(true);
        setResult(null);

        try {
            const parsedCommand: ParsedCommand = await invoke("parse_command", {
                input: command
            });

            const response: CommandResponse = await invoke("execute_os_command", {
                parsedCommand
            });

            setResult(response);

            if (response.success) {
                setCommandHistory(prev => [command, ...prev.slice(0, 9)]);
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
            const response: CommandResponse = await invoke("open_folder", {path});
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
                        OS & Chrome Control Center
                    </h1>
                    <p className="text-xl text-gray-600 dark:text-gray-400">
                        Control your system and Chrome browser with advanced voice commands and Vimium-like navigation
                    </p>
                </div>

                {/* Voice Control Section */}
                <VoiceControl
                    isProcessing={isProcessing}
                    setIsProcessing={setIsProcessing}
                    setResult={setResult}
                    setCommand={setCommand}
                    setCommandHistory={setCommandHistory}
                    chromeSession={chromeSession}
                />

                {/* Chrome Control Section */}
                <ChromeControl
                    isProcessing={isProcessing}
                    setIsProcessing={setIsProcessing}
                    setResult={setResult}
                    setChromeSession={setChromeSession}
                />

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
                            placeholder="Enter command (e.g., 'Open Chrome', 'Open Firefox') or use voice control above"
                            disabled={isProcessing}
                        />
                        <button
                            type="submit"
                            disabled={isProcessing || !command.trim()}
                            className="btn-primary min-w-[140px]"
                        >
                            {isProcessing ? (
                                <div className="flex items-center justify-center gap-2">
                                    <div
                                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Processing...
                                </div>
                            ) : (
                                "Execute"
                            )}
                        </button>
                    </form>
                </div>

                {/* Preset Commands */}
                <PresetCommands isProcessing={isProcessing} setIsProcessing={setIsProcessing}
                                setCommand={setCommand} setResult={setResult}
                                setCommandHistory={setCommandHistory}
                />

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
            </div>
        </main>
    );
}

export default App;