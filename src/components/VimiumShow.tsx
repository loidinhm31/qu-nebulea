import {invoke} from "@tauri-apps/api/core";
import {ChromeSession, CommandResponse, PageElement, PageHints} from "../types/Control.tsx";
import {useState} from "react";
import HintSelection from "./HintSelection.tsx";

interface VimiumShowProps {
    chromeSession: ChromeSession;
    isProcessing: boolean;
    setResult: (result: CommandResponse | null) => void;
    setIsProcessing: (isProcessing: boolean) => void;
}

export default function VimiumShow({chromeSession, isProcessing, setResult, setIsProcessing}: VimiumShowProps) {
    // Vimium-like navigation states
    const [pageHints, setPageHints] = useState<PageHints | null>(null);
    const [hintsVisible, setHintsVisible] = useState(false);
    const [selectedHint, setSelectedHint] = useState<string>("");
    const [hintFilter, setHintFilter] = useState<string>("");
    const [vimiumMode, setVimiumMode] = useState<string>("normal"); // normal, hint_selection, action_selection

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


    return (<>
        <div
            className="card p-6 lg:p-8 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
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
                        <div
                            className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
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
                    <HintSelection vimiumMode={vimiumMode} isProcessing={isProcessing}
                                   hintFilter={hintFilter}
                                   setHintFilter={setHintFilter} chromeSession={chromeSession}
                                   setIsProcessing={setIsProcessing} setResult={setResult}
                                   setSelectedHint={setSelectedHint}
                                   clearPageHints={clearPageHints} selectedHint={selectedHint}
                                   getFilteredElements={getFilteredElements}
                    />
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
                                                            <span
                                                                className="font-mono font-bold text-lg text-purple-600 dark:text-purple-400">
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
    </>)
}