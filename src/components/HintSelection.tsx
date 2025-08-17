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
    const [fillValue, setFillValue] = useState<string>("");

    const hintInputRef = useRef<HTMLInputElement>(null);
    const fillInputRef = useRef<HTMLInputElement>(null);

    // Focus hint input when entering hint selection mode
    useEffect(() => {
        if (vimiumMode === "hint_selection" && hintInputRef.current) {
            hintInputRef.current.focus();
        }
    }, [vimiumMode]);

    // Get the selected element details
    const getSelectedElement = (): PageElement | null => {
        if (!selectedHint) return null;

        return getFilteredElements().find(el => el.hint === selectedHint) || null;
    };

    const selectedElement = getSelectedElement();
    const isTextInputElement = selectedElement &&
        (selectedElement.tag_name === 'input' || selectedElement.tag_name === 'textarea');

    // Auto-switch to fill action for text inputs when selected
    useEffect(() => {
        if (isTextInputElement && selectedActionType === "click") {
            setSelectedActionType("fill");
        }
    }, [selectedHint, isTextInputElement]);

    const interactWithElement = async (hint: string, actionType: string = selectedActionType, value?: string) => {
        if (!chromeSession) return;

        setIsProcessing(true);
        try {
            const action: ElementAction = {
                hint: hint,
                action_type: actionType,
                value: (actionType === "fill" || actionType === "set_value") ? (value || fillValue) : undefined
            };

            const result: string = await invoke("chrome_interact_with_element", {
                sessionId: chromeSession.session_id,
                action: action
            });

            setResult({
                success: true,
                message: `Performed ${actionType} on element ${hint}: ${result}`
            });

            // Clear fill value after successful fill
            if (actionType === "fill" || actionType === "set_value") {
                setFillValue("");
            }

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
            if (selectedActionType === "fill" && isTextInputElement) {
                // Focus fill input if we need to fill but don't have a value
                if (!fillValue && fillInputRef.current) {
                    fillInputRef.current.focus();
                    return;
                }
            }
            interactWithElement(selectedHint);
        } else if (e.key === 'Escape') {
            clearPageHints();
        }
    };

    const handleFillKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && selectedHint && fillValue) {
            interactWithElement(selectedHint, "fill", fillValue);
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

    const getActionTypeOptions = () => {
        const baseOptions = [
            { value: "click", label: "Click" },
            { value: "right_click", label: "Right Click" },
            { value: "hover", label: "Hover" },
            { value: "focus", label: "Focus" }
        ];

        if (isTextInputElement) {
            baseOptions.unshift({ value: "fill", label: "Fill Text" });
        }

        return baseOptions;
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
                            className="vimium-filter-input"
                            placeholder="Type hint (e.g., 'a', 'b') or search text..."
                            disabled={isProcessing}
                        />
                    </div>

                    {/* Show selected element info */}
                    {selectedElement && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="vimium-hint-badge">
                                    {selectedElement.hint.toUpperCase()}
                                </span>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {selectedElement.tag_name.toUpperCase()}
                                    {selectedElement.element_type !== 'none' && ` (${selectedElement.element_type})`}
                                </span>
                                {isTextInputElement && (
                                    <span className="px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs rounded-full">
                                        Text Input
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                {selectedElement.text || selectedElement.href || 'No content'}
                            </p>
                        </div>
                    )}

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
                            {getActionTypeOptions().map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Show fill input for text elements when fill action is selected */}
                    {(selectedActionType === "fill" || selectedActionType === "set_value") && isTextInputElement && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Text to Fill
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                                    (Press Enter to fill)
                                </span>
                            </label>
                            <input
                                ref={fillInputRef}
                                type="text"
                                value={fillValue}
                                onChange={(e) => setFillValue(e.target.value)}
                                onKeyDown={handleFillKeyPress}
                                className="input-primary"
                                placeholder="Enter text to fill into the selected element..."
                                disabled={isProcessing}
                            />
                        </div>
                    )}

                    {selectedHint && (
                        <div className="space-y-2">
                            <button
                                onClick={() => interactWithElement(selectedHint)}
                                disabled={isProcessing || ((selectedActionType === "fill" || selectedActionType === "set_value") && !fillValue)}
                                className="btn-primary w-full"
                            >
                                {selectedActionType === "fill" || selectedActionType === "set_value"
                                    ? `Fill "${selectedHint.toUpperCase()}" with Text`
                                    : `${selectedActionType.charAt(0).toUpperCase() + selectedActionType.slice(1).replace('_', ' ')} Element "${selectedHint.toUpperCase()}"`
                                }
                            </button>

                            {/* Quick action buttons for text inputs */}
                            {isTextInputElement && selectedActionType !== "fill" && (
                                <button
                                    onClick={() => {
                                        setSelectedActionType("fill");
                                        if (fillInputRef.current) {
                                            fillInputRef.current.focus();
                                        }
                                    }}
                                    className="btn-secondary w-full text-sm"
                                >
                                    📝 Switch to Fill Mode
                                </button>
                            )}
                        </div>
                    )}

                    {/* Quick fill templates for common use cases */}
                    {selectedActionType === "fill" && isTextInputElement && (
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Quick Fill Templates
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setFillValue("test@example.com")}
                                    className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                    Test Email
                                </button>
                                <button
                                    onClick={() => setFillValue("Test User")}
                                    className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                    Test Name
                                </button>
                                <button
                                    onClick={() => setFillValue("123-456-7890")}
                                    className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                    Test Phone
                                </button>
                                <button
                                    onClick={() => setFillValue("Password123!")}
                                    className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                    Test Password
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}