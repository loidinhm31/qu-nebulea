import {useEffect, useRef, useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {ChromeSession, CommandResponse, ElementAction, PageElement} from "../types/Control.tsx";

interface HintSelectionProps {
    chromeSession: ChromeSession;
    isProcessing: boolean;
    setIsProcessing: (isProcessing: boolean) => void;
    vimiumMode: string;
    hintFilter: string;
    setHintFilter: (filter: string) => void;
    setResult: (result: CommandResponse | null) => void;
    selectedHint: string;
    setSelectedHint: (selectedHint: string) => void;
    clearPageHints: () => void;
    getFilteredElements: () => PageElement[];
}

export default function HintSelection({
                                          chromeSession,
                                          isProcessing,
                                          setIsProcessing,
                                          vimiumMode,
                                          hintFilter,
                                          setHintFilter,
                                          selectedHint,
                                          setSelectedHint,
                                          setResult,
                                          clearPageHints,
                                          getFilteredElements
                                      }: HintSelectionProps) {
    const [selectedActionType, setSelectedActionType] = useState<string>("click");

    const hintInputRef = useRef<HTMLInputElement>(null);

    // Focus hint input when entering hint selection mode
    useEffect(() => {
        if (vimiumMode === "hint_selection" && hintInputRef.current) {
            hintInputRef.current.focus();
        }
    }, [vimiumMode]);

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

    return (
        <>
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
                            onKeyDown={handleHintKeyPress}
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
                            {selectedActionType.charAt(0).toUpperCase() + selectedActionType.slice(1).replace('_', ' ')} Element
                            "{selectedHint.toUpperCase()}"
                        </button>
                    )}
                </div>
            </div>
        </>
    )
}