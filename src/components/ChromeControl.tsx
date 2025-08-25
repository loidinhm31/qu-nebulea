import {useEffect, useState} from "react";
import {ChromeControlOptions, ChromeSession, ChromeTarget, CommandResponse} from "../types/Control.tsx";
import {invoke} from "@tauri-apps/api/core";
import ChromeTargets from "./ChromeTargets.tsx";
import VimiumShow from "./VimiumShow.tsx";

interface ChromeControlProps {
    isProcessing: boolean;
    setIsProcessing: (isProcessing: boolean) => void;
    setResult: (value: CommandResponse | null) => void;
    setChromeSession: (session: ChromeSession | null) => void; // Add this line
}

export default function ChromeControl({isProcessing, setIsProcessing, setResult, setChromeSession}: ChromeControlProps) {
    const [chromeSession, setChromeSessionLocal] = useState<ChromeSession | null>(null);
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

    // Update parent component when chrome session changes
    const updateChromeSession = (session: ChromeSession | null) => {
        setChromeSessionLocal(session);
        setChromeSession(session);
    };

    const loadChromeProfiles = async () => {
        try {
            const profileList: string[] = await invoke("chrome_get_profiles");
            setProfiles(profileList);
        } catch (error) {
            console.error("Failed to load Chrome profiles:", error);
        }
    };

    const openChromeWithControl = async () => {
        setIsProcessing(true);
        setDebugInfo("");
        setChromeTargets([]);
        try {
            const options: ChromeControlOptions = {
                profile: selectedProfile !== "Default" ? selectedProfile : undefined,
                url: navigationUrl,
                debug_port: 9222
            };

            const session: ChromeSession = await invoke("open_chrome_with_control", {options});
            updateChromeSession(session);
            setResult({
                success: true,
                message: `Chrome opened with control enabled. Session ID: ${session.session_id}, Port: ${session.debug_port}`
            });

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

    const closeChromeSession = () => {
        updateChromeSession(null);
        setChromeTargets([]);
        setSelectedTargetId("");
        setDebugInfo("");
        setScriptResult("");
        setResult({
            success: true,
            message: "Chrome session closed"
        });
    };

    return (
        <div
            className="card p-6 lg:p-8 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
            <h2 className="text-2xl font-bold mb-6 text-blue-700 dark:text-blue-300">
                🌐 Chrome Control Center
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
                                disabled={isProcessing || !!chromeSession}
                                className="btn-primary"
                            >
                                {chromeSession ? "Chrome Connected ✓" : "Open Chrome with Control"}
                            </button>

                            {chromeSession && (
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={getDebugInfo}
                                        disabled={isProcessing}
                                        className="btn-secondary"
                                    >
                                        Debug Connection
                                    </button>
                                    <button
                                        onClick={closeChromeSession}
                                        disabled={isProcessing}
                                        className="btn-secondary bg-red-100 hover:bg-red-200 text-red-700"
                                    >
                                        Close Session
                                    </button>
                                </div>
                            )}
                        </div>

                        {chromeSession && (
                            <div
                                className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Session:</span> {chromeSession.session_id.substring(0, 8)}...
                                </p>
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Port:</span> {chromeSession.debug_port}
                                </p>
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Targets:</span> {chromeTargets.length}
                                </p>
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Voice Control:</span> Available ✓
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Vimium Navigation Section */}
                {chromeSession && (
                    <VimiumShow setResult={setResult} chromeSession={chromeSession} isProcessing={isProcessing}
                                setIsProcessing={setIsProcessing}/>
                )}

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
                                        <pre
                                            className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
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
                <ChromeTargets isProcessing={isProcessing} chromeTargets={chromeTargets}
                               selectedTargetId={selectedTargetId}
                               setSelectedTargetId={setSelectedTargetId}
                               loadChromeTargets={loadChromeTargets}/>
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
                        onClick={() => setScriptToExecute("document.querySelectorAll('a').length")}
                        className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                        Count Links
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

            {/* Voice Control Integration Notice */}
            {chromeSession && (
                <div className="mt-6 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <h4 className="text-md font-semibold text-purple-700 dark:text-purple-300 mb-2">
                        🎤 Voice Control Available
                    </h4>
                    <p className="text-sm text-purple-600 dark:text-purple-400">
                        Chrome session is now available for voice commands. Switch to Chrome or Vimium mode in the Voice Control section above to use advanced voice commands like:
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded">
                            "Show page hints"
                        </div>
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded">
                            "Click A"
                        </div>
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded">
                            "Navigate to google.com"
                        </div>
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded">
                            "Scroll down"
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}