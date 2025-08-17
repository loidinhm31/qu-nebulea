import { useState, useEffect } from "react";
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

interface ChromeControlOptions {
    url?: string;
    profile?: string;
    debug_port?: number;
}

interface ChromeTarget {
    id: string;
    target_type: string;
    title: string;
    url: string;
    websocket_debugger_url: string;
}

interface ChromeSession {
    debug_port: number;
    session_id: string;
}

function App() {
    const [command, setCommand] = useState("");
    const [result, setResult] = useState<CommandResponse | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);

    // Chrome control states
    const [chromeSession, setChromeSession] = useState<ChromeSession | null>(null);
    const [profiles, setProfiles] = useState<string[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<string>("Default");
    const [navigationUrl, setNavigationUrl] = useState<string>("https://www.google.com");
    const [scriptToExecute, setScriptToExecute] = useState<string>("document.title");
    const [scriptResult, setScriptResult] = useState<string>("");
    const [debugInfo, setDebugInfo] = useState<string>("");
    const [chromeTargets, setChromeTargets] = useState<ChromeTarget[]>([]);
    const [selectedTargetId, setSelectedTargetId] = useState<string>("");

    useEffect(() => {
        loadChromeProfiles();
    }, []);

    const loadChromeProfiles = async () => {
        try {
            const profileList: string[] = await invoke("chrome_get_profiles");
            setProfiles(profileList);
        } catch (error) {
            console.error("Failed to load Chrome profiles:", error);
        }
    };

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

    const openChromeWithControl = async () => {
        setIsProcessing(true);
        setDebugInfo(""); // Clear previous debug info
        setChromeTargets([]); // Clear previous targets
        try {
            const options: ChromeControlOptions = {
                profile: selectedProfile !== "Default" ? selectedProfile : undefined,
                url: navigationUrl,
                debug_port: 9222
            };

            const session: ChromeSession = await invoke("open_chrome_with_control", { options });
            setChromeSession(session);
            setResult({
                success: true,
                message: `Chrome opened with control enabled. Session ID: ${session.session_id}, Port: ${session.debug_port}`
            });

            // Load targets after successful connection
            setTimeout(async () => {
                await loadChromeTargets();
            }, 1000);
        } catch (error) {
            setResult({
                success: false,
                message: `Failed to open Chrome with control: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const executeScript = async () => {
        if (!chromeSession) {
            setResult({
                success: false,
                message: "No active Chrome session. Please open Chrome with control first."
            });
            return;
        }

        setIsProcessing(true);
        try {
            const result: string = await invoke("chrome_execute_script", {
                sessionId: chromeSession.session_id,
                script: scriptToExecute
            });
            setScriptResult(result);
            setResult({
                success: true,
                message: "Script executed successfully"
            });
        } catch (error) {
            setResult({
                success: false,
                message: `Script execution failed: ${error}`
            });
            setScriptResult("");
        } finally {
            setIsProcessing(false);
        }
    };

    const getDebugInfo = async () => {
        if (!chromeSession) {
            setDebugInfo("No active Chrome session");
            return;
        }

        setIsProcessing(true);
        try {
            const info: string = await invoke("chrome_debug_info", {
                sessionId: chromeSession.session_id
            });
            setDebugInfo(info);

            // Also load current targets
            await loadChromeTargets();
        } catch (error) {
            setDebugInfo(`Debug info failed: ${error}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const loadChromeTargets = async () => {
        if (!chromeSession) {
            setChromeTargets([]);
            return;
        }

        try {
            const targets: ChromeTarget[] = await invoke("chrome_get_targets", {
                sessionId: chromeSession.session_id
            });
            setChromeTargets(targets);

            // Auto-select first page target if none selected
            if (!selectedTargetId && targets.length > 0) {
                const pageTarget = targets.find(t => t.target_type === "page" && !t.url.startsWith("chrome-extension://"));
                if (pageTarget) {
                    setSelectedTargetId(pageTarget.id);
                }
            }
        } catch (error) {
            console.error("Failed to load Chrome targets:", error);
            setChromeTargets([]);
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
                        OS & Chrome Control Center
                    </h1>
                    <p className="text-xl text-gray-600 dark:text-gray-400">
                        Control your system and Chrome browser with advanced WebSocket capabilities
                    </p>
                </div>

                {/* Chrome Control Section */}
                <div className="card p-6 lg:p-8 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
                    <h2 className="text-2xl font-bold mb-6 text-blue-700 dark:text-blue-300">
                        🌐 Chrome Control Center (WebSocket Direct Connection)
                    </h2>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Chrome Launch */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                                Launch Chrome with Control
                            </h3>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Profile
                                    </label>
                                    <select
                                        value={selectedProfile}
                                        onChange={(e) => setSelectedProfile(e.target.value)}
                                        className="input-primary"
                                        disabled={isProcessing}
                                    >
                                        {profiles.map((profile) => (
                                            <option key={profile} value={profile}>
                                                {profile}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Initial URL
                                    </label>
                                    <input
                                        type="url"
                                        value={navigationUrl}
                                        onChange={(e) => setNavigationUrl(e.target.value)}
                                        className="input-primary"
                                        placeholder="https://www.example.com"
                                        disabled={isProcessing}
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-2">
                                    <button
                                        onClick={openChromeWithControl}
                                        disabled={isProcessing}
                                        className="btn-primary"
                                    >
                                        {chromeSession ? "Chrome Connected ✓" : "Open Chrome with Control"}
                                    </button>

                                    {chromeSession && (
                                        <button
                                            onClick={getDebugInfo}
                                            disabled={isProcessing}
                                            className="btn-secondary"
                                        >
                                            Debug Chrome Connection
                                        </button>
                                    )}
                                </div>

                                {chromeSession && (
                                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            Session: {chromeSession.session_id.substring(0, 8)}...
                                        </p>
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            Port: {chromeSession.debug_port}
                                        </p>
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            Targets: {chromeTargets.length}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Chrome Navigation & Script Execution */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                                Navigation & Script Execution
                            </h3>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        JavaScript to Execute
                                    </label>
                                    <div className="space-y-2">
                                        <textarea
                                            value={scriptToExecute}
                                            onChange={(e) => setScriptToExecute(e.target.value)}
                                            className="input-primary h-20 resize-none"
                                            placeholder="document.title"
                                            disabled={isProcessing}
                                        />
                                        <button
                                            onClick={executeScript}
                                            disabled={isProcessing || !chromeSession}
                                            className="btn-secondary w-full"
                                        >
                                            Execute Script
                                        </button>
                                        {scriptResult && (
                                            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Result:</p>
                                                <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                                                    {scriptResult}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Chrome Targets Display */}
                    {chromeTargets.length > 0 && (
                        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600 space-y-4">
                            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                                Available Chrome Targets
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Select Target for Operations
                                    </label>
                                    <select
                                        value={selectedTargetId}
                                        onChange={(e) => setSelectedTargetId(e.target.value)}
                                        className="input-primary"
                                        disabled={isProcessing}
                                    >
                                        <option value="">Auto-select best target</option>
                                        {chromeTargets.map((target) => (
                                            <option key={target.id} value={target.id}>
                                                [{target.target_type}] {target.title} - {target.url.substring(0, 50)}
                                                {target.url.length > 50 ? '...' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <button
                                    onClick={loadChromeTargets}
                                    disabled={isProcessing}
                                    className="btn-secondary"
                                >
                                    Refresh Targets
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Debug Info Display */}
                    {debugInfo && (
                        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600">
                            <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">
                                Debug Information
                            </h4>
                            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                                    {debugInfo}
                                </pre>
                            </div>
                        </div>
                    )}

                    {/* Quick Script Examples */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600">
                        <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">
                            Quick Script Examples (Direct CDP)
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <button
                                onClick={() => setScriptToExecute("document.title")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Get Title
                            </button>
                            <button
                                onClick={() => setScriptToExecute("window.location.href")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Get URL
                            </button>
                            <button
                                onClick={() => setScriptToExecute("document.querySelectorAll('a').length")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Count Links
                            </button>
                            <button
                                onClick={() => setScriptToExecute("document.querySelector('h1')?.textContent")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Get H1 Text
                            </button>
                            <button
                                onClick={() => setScriptToExecute("document.body.style.backgroundColor = 'lightblue'")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Change BG
                            </button>
                            <button
                                onClick={() => setScriptToExecute("document.cookie")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Get Cookies
                            </button>
                            <button
                                onClick={() => setScriptToExecute("JSON.stringify({url: location.href, title: document.title, links: document.links.length})")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Page Info
                            </button>
                            <button
                                onClick={() => setScriptToExecute("navigator.userAgent")}
                                className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                User Agent
                            </button>
                        </div>
                    </div>
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
                        Direct Chrome DevTools Protocol Integration
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300">
                                ✨ WebSocket CDP Features:
                            </h4>
                            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                                <li>• Direct WebSocket connection to Chrome targets</li>
                                <li>• Real-time script execution via Runtime.evaluate</li>
                                <li>• Page navigation via Page.navigate</li>
                                <li>• Target-specific operations</li>
                                <li>• Full Chrome DevTools Protocol support</li>
                                <li>• No dependency on third-party libraries</li>
                                <li>• Connection testing and diagnostics</li>
                            </ul>
                        </div>
                        <div className="space-y-3">
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300">
                                🔧 How it works:
                            </h4>
                            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                                <li>• Connects to ws://127.0.0.1:9222/devtools/page/id</li>
                                <li>• Sends CDP messages in JSON format</li>
                                <li>• Each message has unique ID for response tracking</li>
                                <li>• Real-time bidirectional communication</li>
                                <li>• Automatic target discovery and selection</li>
                                <li>• Error handling and timeout management</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

export default App;