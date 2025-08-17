import {CommandResponse, ParsedCommand} from "../types/Control.tsx";
import {invoke} from "@tauri-apps/api/core";

interface ParsedCommandsProps {
    isProcessing: boolean;
    setIsProcessing: (isProcessing: boolean) => void;
    setCommand: (command: string) => void;
    setResult: (result: CommandResponse | null) => void;
    setCommandHistory: (commandHistory: string[] | ((prev: string[]) => string[])) => void;
}

export default function PresetCommands({
                                           isProcessing,
                                           setIsProcessing,
                                           setCommand,
                                           setResult,
                                           setCommandHistory
                                       }: ParsedCommandsProps) {
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
                setCommandHistory((prev: string[]) => [presetCommand, ...prev.slice(0, 9)]);
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

    return (
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
    )
}