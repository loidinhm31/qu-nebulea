import { useState, useEffect, useRef } from "react";
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

interface PageElement {
    hint: string;
    tag_name: string;
    element_type: string;
    text: string;
    href?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    selector: string;
}

interface PageHints {
    elements: PageElement[];
    total_count: number;
    visible_count: number;
}

interface ElementAction {
    hint: string;
    action_type: string;
    modifier_keys?: string[];
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

    // Vimium-like navigation states
    const [pageHints, setPageHints] = useState<PageHints | null>(null);
    const [hintsVisible, setHintsVisible] = useState(false);
    const [selectedHint, setSelectedHint] = useState<string>("");
    const [hintFilter, setHintFilter] = useState<string>("");
    const [selectedActionType, setSelectedActionType] = useState<string>("click");
    const [vimiumMode, setVimiumMode] = useState<string>("normal"); // normal, hint_selection, action_selection

    const hintInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadChromeProfiles();
    }, []);

    // Focus hint input when entering hint selection mode
    useEffect(() => {
        if (vimiumMode === "hint_selection" && hintInputRef.current) {
            hintInputRef.current.focus();
        }
    }, [vimiumMode]);

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
        setDebugInfo("");
        setChromeTargets([]);
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

    // Vimium-like navigation functions
    const showPageHints = async () => {
        if (!chromeSession) {
            setResult({
                success: false,
                message: "No active Chrome session. Please open Chrome with control first."
            });
            return;
        }

        setIsProcessing(true);
        try {
            const hints: PageHints = await invoke("chrome_show_page_hints", {
                sessionId: chromeSession.session_id
            });
            setPageHints(hints);
            setHintsVisible(true);
            setVimiumMode("hint_selection");
            setHintFilter("");
            setResult({
                success: true,
                message: `Found ${hints.visible_count} interactive elements on the page`
            });
        } catch (error) {
            setResult({
                success: false,
                message: `Failed to show page hints: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const clearPageHints = async () => {
        if (!chromeSession) return;

        setIsProcessing(true);
        try {
            await invoke("chrome_clear_page_hints", {
                sessionId: chromeSession.session_id
            });
            setPageHints(null);
            setHintsVisible(false);
            setVimiumMode("normal");
            setHintFilter("");
            setSelectedHint("");
            setResult({
                success: true,
                message: "Page hints cleared"
            });
        } catch (error) {
            setResult({
                success: false,
                message: `Failed to clear hints: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const interactWithElement = async (hint: string, actionType: string = selectedActionType) => {
        if (!chromeSession) return;

        setIsProcessing(true);
        try {
            const action: ElementAction = {
                hint: hint,
                action_type: actionType
            };

            const result: string = await invoke("chrome_interact_with_element", {
                sessionId: chromeSession.session_id,
                action: action
            });

            setResult({
                success: true,
                message: `Performed ${actionType} on element ${hint}: ${result}`
            });

            // Clear hints after successful interaction
            setTimeout(() => {
                clearPageHints();
            }, 1000);

        } catch (error) {
            setResult({
                success: false,
                message: `Failed to interact with element: ${error}`
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleHintKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && selectedHint) {
            interactWithElement(selectedHint);
        } else if (e.key === 'Escape') {
            clearPageHints();
        }
    };

    const handleHintFilterChange = (value: string) => {
        setHintFilter(value.toLowerCase());

        // Auto-select if only one hint matches
        const matchingHints = getFilteredElements().map(el => el.hint);
        if (matchingHints.length === 1) {
            setSelectedHint(matchingHints[0]);
        } else if (matchingHints.includes(value.toLowerCase())) {
            setSelectedHint(value.toLowerCase());
        } else {
            setSelectedHint("");
        }
    };

    const getFilteredElements = (): PageElement[] => {
        if (!pageHints) return [];

        if (!hintFilter) return pageHints.elements;

        return pageHints.elements.filter(el =>
            el.hint.toLowerCase().startsWith(hintFilter.toLowerCase()) ||
            el.text.toLowerCase().includes(hintFilter.toLowerCase()) ||
            el.tag_name.toLowerCase().includes(hintFilter.toLowerCase())
        );
    };

    const getElementTypeIcon = (element: PageElement): string => {
        if (element.tag_name === 'a') return '🔗';
        if (element.tag_name === 'button') return '🔘';
        if (element.tag_name === 'input') {
            if (element.element_type === 'submit') return '✅';
            if (element.element_type === 'checkbox') return '☑️';
            if (element.element_type === 'radio') return '🔘';
            return '📝';
        }
        if (element.tag_name === 'select') return '📋';
        if (element.tag_name === 'textarea') return '📝';
        return '🎯';
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
                        Control your system and Chrome browser with Vimium-like navigation
                    </p>
                </div>

                {/* Vimium Navigation Section */}
                {chromeSession && (
                    <div className="card p-6 lg:p-8 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
                        <h2 className="text-2xl font-bold mb-6 text-purple-700 dark:text-purple-300">
                            🎯 Vimium-like Page Navigation
                        </h2>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Hint Control */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                                    Page Element Detection
                                </h3>

                                <div className="flex gap-2">
                                    <button
                                        onClick={showPageHints}
                                        disabled={isProcessing || hintsVisible}
                                        className="btn-primary flex-1"
                                    >
                                        {hintsVisible ? "Hints Active ✨" : "Show Page Hints"}
                                    </button>
                                    <button
                                        onClick={clearPageHints}
                                        disabled={isProcessing || !hintsVisible}
                                        className="btn-secondary"
                                    >
                                        Clear
                                    </button>
                                </div>

                                {pageHints && (
                                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                                        <p className="text-sm text-purple-700 dark:text-purple-300">
                                            Found {pageHints.visible_count} interactive elements
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400">
                                            Total: {pageHints.total_count} elements detected
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Hint Selection */}
                            {hintsVisible && (
                                <div className="space-y-4">
                                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                                        Element Selection
                                    </h3>

                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                Filter/Select Hint
                                            </label>
                                            <input
                                                ref={hintInputRef}
                                                type="text"
                                                value={hintFilter}
                                                onChange={(e) => handleHintFilterChange(e.target.value)}
                                                onKeyPress={handleHintKeyPress}
                                                className="input-primary"
                                                placeholder="Type hint (e.g., 'a', 'b') or search text..."
                                                disabled={isProcessing}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                Action Type
                                            </label>
                                            <select
                                                value={selectedActionType}
                                                onChange={(e) => setSelectedActionType(e.target.value)}
                                                className="input-primary"
                                                disabled={isProcessing}
                                            >
                                                <option value="click">Click</option>
                                                <option value="right_click">Right Click</option>
                                                <option value="hover">Hover</option>
                                                <option value="focus">Focus</option>
                                            </select>
                                        </div>

                                        {selectedHint && (
                                            <button
                                                onClick={() => interactWithElement(selectedHint)}
                                                disabled={isProcessing}
                                                className="btn-primary w-full"
                                            >
                                                {selectedActionType.charAt(0).toUpperCase() + selectedActionType.slice(1).replace('_', ' ')} Element "{selectedHint.toUpperCase()}"
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Elements List */}
                        {hintsVisible && pageHints && (
                            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600">
                                <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">
                                    Interactive Elements ({getFilteredElements().length} of {pageHints.elements.length})
                                </h4>

                                <div className="max-h-96 overflow-y-auto space-y-2">
                                    {getFilteredElements().map((element, index) => (
                                        <div
                                            key={index}
                                            className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
                                                selectedHint === element.hint
                                                    ? 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-600'
                                                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                            onClick={() => {
                                                setSelectedHint(element.hint);
                                                setHintFilter(element.hint);
                                            }}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-2xl">{getElementTypeIcon(element)}</span>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono font-bold text-lg text-purple-600 dark:text-purple-400">
                                                                {element.hint.toUpperCase()}
                                                            </span>
                                                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                                                {element.tag_name}
                                                                {element.element_type !== 'none' && ` (${element.element_type})`}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                                            {element.text || element.href || 'No text content'}
                                                        </p>
                                                        {element.href && (
                                                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                                                → {element.href}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                                                    <div>({Math.round(element.x)}, {Math.round(element.y)})</div>
                                                    <div>{Math.round(element.width)}×{Math.round(element.height)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {getFilteredElements().length === 0 && hintFilter && (
                                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                        No elements match "{hintFilter}"
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Quick Actions */}
                        {hintsVisible && (
                            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600">
                                <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">
                                    Quick Actions
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => setHintFilter("a")}
                                        className="text-sm px-3 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60"
                                    >
                                        First Link (a)
                                    </button>
                                    <button
                                        onClick={() => {
                                            const buttons = getFilteredElements().filter(el => el.tag_name === 'button');
                                            if (buttons.length > 0) setHintFilter(buttons[0].hint);
                                        }}
                                        className="text-sm px-3 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60"
                                    >
                                        First Button
                                    </button>
                                    <button
                                        onClick={() => {
                                            const inputs = getFilteredElements().filter(el => el.tag_name === 'input');
                                            if (inputs.length > 0) setHintFilter(inputs[0].hint);
                                        }}
                                        className="text-sm px-3 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60"
                                    >
                                        First Input
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

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
                        Vimium-like Navigation & Chrome DevTools Integration
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300">
                                ✨ Vimium Features:
                            </h4>
                            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                                <li>• Visual hint overlays on interactive elements</li>
                                <li>• Keyboard navigation with hint letters</li>
                                <li>• Click, right-click, hover, and focus actions</li>
                                <li>• Real-time element filtering and search</li>
                                <li>• Smart element detection (links, buttons, inputs)</li>
                                <li>• Visual element positioning and sizing info</li>
                                <li>• Quick actions for common element types</li>
                            </ul>
                        </div>
                        <div className="space-y-3">
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300">
                                🔧 How to use:
                            </h4>
                            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                                <li>• Click "Show Page Hints" to scan for elements</li>
                                <li>• Type hint letters (a, b, c...) to select elements</li>
                                <li>• Use search to filter by text content</li>
                                <li>• Choose action type before clicking elements</li>
                                <li>• Press Enter to interact with selected element</li>
                                <li>• Press Escape to clear hints and exit</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

export default App;