import {ChromeTarget} from "../types/Control.tsx";

interface ChromeTargetProps {
    isProcessing: boolean;
    chromeTargets: ChromeTarget[];
    loadChromeTargets: () => void;
    selectedTargetId: string;
    setSelectedTargetId: (id: string) => void;
}

export default function ChromeTargets({
                                          isProcessing,
                                          chromeTargets,
                                          loadChromeTargets,
                                          selectedTargetId,
                                          setSelectedTargetId
                                      }: ChromeTargetProps) {
    return (
        <>
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
        </>
    )
}