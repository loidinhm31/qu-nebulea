import {useCallback, useEffect, useRef, useState} from "react";
import {ChromeSession, CommandResponse} from "../types/Control.tsx";

interface VoiceControlProps {
    isProcessing: boolean;
    setIsProcessing: (isProcessing: boolean) => void;
    setResult: (result: CommandResponse | null) => void;
    setCommand: (command: string) => void;
    setCommandHistory: (commandHistory: string[] | ((prev: string[]) => string[])) => void;
    chromeSession?: ChromeSession | null;
}

interface AudioConfig {
    serverUrl: string;
    chunkSize: number;
    audioQuality: number;
    silenceThreshold: number;
    autoCommitDelay: number;
}

interface AudioStats {
    totalChunks: number;
    totalBytes: number;
    latencySum: number;
    latencyCount: number;
    bufferSize: number;
}

interface LogEntry {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    timestamp: string;
}

export default function VoiceControl({
                                         isProcessing,
                                         setIsProcessing,
                                         setResult,
                                         setCommand,
                                         setCommandHistory,
                                     }: VoiceControlProps) {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);

    const [audioConfig, setAudioConfig] = useState<AudioConfig>({
        serverUrl: 'ws://localhost:3000/ws',
        chunkSize: 250,
        audioQuality: 16000,
        silenceThreshold: 0.005,
        autoCommitDelay: 1500
    });

    const [audioStats, setAudioStats] = useState<AudioStats>({
        totalChunks: 0,
        totalBytes: 0,
        latencySum: 0,
        latencyCount: 0,
        bufferSize: 0
    });

    const [transcription, setTranscription] = useState<string>("Ready to receive transcriptions...");
    const [sessionInfo, setSessionInfo] = useState<{ id: string, model: string } | null>(null);
    const [audioLevel, setAudioLevel] = useState<number>(0);
    const [confidenceIndicator, setConfidenceIndicator] = useState<string>("");
    const [silenceDetected, setSilenceDetected] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([
        {message: "Audio streaming client initialized", type: "info", timestamp: new Date().toLocaleTimeString()},
        {message: "Click 'Connect to Server' to begin", type: "info", timestamp: new Date().toLocaleTimeString()}
    ]);

    const wsRef = useRef<WebSocket | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const audioBufferRef = useRef<number[]>([]);
    const debugAudioDataRef = useRef<number[]>([]);
    const sessionIdRef = useRef<string | null>(null);
    const chunkCounterRef = useRef<number>(0);
    const totalBytesRef = useRef<number>(0);
    const latencySumRef = useRef<number>(0);
    const latencyCountRef = useRef<number>(0);
    const isProcessingAudioRef = useRef<boolean>(false);
    const isSleepingRef = useRef<boolean>(false);

    const silenceDetectionBufferRef = useRef<number[]>([]);
    const silenceDetectionWindow = 10;
    const lastSpeechTimeRef = useRef<number>(Date.now());
    const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasSpeechInBufferRef = useRef<boolean>(false);

    const audioLevelHistoryRef = useRef<number[]>(new Array(50).fill(0));

    useEffect(() => {
        return () => {
            disconnect();
            if (silenceTimeoutRef.current) {
                clearTimeout(silenceTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (isRecording) {
            startAudioProcessing();
        }
    }, [isRecording]);

    const log = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const newLog: LogEntry = {message, type, timestamp};

        setLogs(prev => {
            const newLogs = [newLog, ...prev];
            return newLogs.slice(0, 100); // Keep only last 100 entries
        });

        console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    }, []);

    const formatBytes = useCallback((bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }, []);

    const detectSilence = useCallback((audioData: Float32Array) => {
        const rms = Math.sqrt(audioData.reduce((sum, sample) => sum + sample * sample, 0) / audioData.length);

        silenceDetectionBufferRef.current.push(rms);
        if (silenceDetectionBufferRef.current.length > silenceDetectionWindow) {
            silenceDetectionBufferRef.current.shift();
        }

        const avgRms = silenceDetectionBufferRef.current.reduce((sum, val) => sum + val, 0) / silenceDetectionBufferRef.current.length;
        const isSilent = avgRms < audioConfig.silenceThreshold;
        const currentTime = Date.now();
        const timeSinceLastSpeech = currentTime - lastSpeechTimeRef.current;

        if (!isSilent) {
            lastSpeechTimeRef.current = currentTime;
            hasSpeechInBufferRef.current = true;
            setSleeping(false);

            if (silenceTimeoutRef.current) {
                clearTimeout(silenceTimeoutRef.current);
                silenceTimeoutRef.current = null;
            }
        } else {
            if (audioConfig.autoCommitDelay > 0 &&
                timeSinceLastSpeech >= audioConfig.autoCommitDelay &&
                hasSpeechInBufferRef.current &&
                !isProcessingAudioRef.current) {
                log(`Auto-committing after ${audioConfig.autoCommitDelay}ms of silence`);
                commitAudioBuffer();
            } else if (timeSinceLastSpeech >= 1000 && !hasSpeechInBufferRef.current) {
                setSleeping(true);
            }
        }

        setSilenceDetected(isSilent && timeSinceLastSpeech > 500);

        return {isSilent, avgRms, timeSinceLastSpeech};
    }, [audioConfig.silenceThreshold, audioConfig.autoCommitDelay, log]);

    const setSleeping = useCallback((sleeping: boolean) => {
        if (isSleepingRef.current !== sleeping) {
            isSleepingRef.current = sleeping;
            if (sleeping) {
                log('Entering sleep mode due to prolonged silence');
            } else {
                log('Waking up from sleep mode');
            }
        }
    }, [isSleepingRef.current, log]);

    const setProcessing = useCallback((processing: boolean) => {
        if (isProcessingAudioRef.current !== processing) {
            isProcessingAudioRef.current = processing;
            if (processing) {
                log('Entering processing mode - pausing audio capture');
                setTranscription('Processing audio...');
            } else {
                log('Exiting processing mode - resuming audio capture');
            }
        }
    }, [isProcessingAudioRef.current, log]);

    const updateVisualization = useCallback((audioData: Float32Array) => {
        const bars = audioLevelHistoryRef.current;
        const chunkSize = Math.floor(audioData.length / bars.length);

        const newLevels: number[] = [];
        for (let i = 0; i < bars.length; i++) {
            const start = i * chunkSize;
            const chunk = audioData.slice(start, start + chunkSize);
            let sum = 0;
            for (let j = 0; j < chunk.length; j++) {
                sum += Math.abs(chunk[j]);
            }
            const average = sum / chunk.length;
            const height = Math.min(average * 300, 60);
            newLevels[i] = height;
        }

        audioLevelHistoryRef.current = newLevels;
    }, []);

    const processAudioData = useCallback((audioData: Float32Array) => {
        const silenceInfo = detectSilence(audioData);
        setAudioLevel(silenceInfo.avgRms);
        updateVisualization(audioData);

        // Skip audio buffering if in sleep mode or processing mode
        if (isSleepingRef.current || isProcessingAudioRef.current) {
            return;
        }

        // Convert float32 to int16 PCM
        const pcmData: number[] = [];
        for (let i = 0; i < audioData.length; i++) {
            const sample = Math.max(-1, Math.min(1, audioData[i]));
            pcmData.push(sample * 32767);
        }

        // Add to buffer (only when active)
        audioBufferRef.current.push(...pcmData);
        debugAudioDataRef.current.push(...pcmData);

        // Update buffer size
        const bufferSizeSeconds = audioBufferRef.current.length / (audioConfig.audioQuality * 2);
        setAudioStats(prev => ({...prev, bufferSize: bufferSizeSeconds}));
    }, [detectSilence, updateVisualization, isSleepingRef.current, isProcessingAudioRef.current, audioConfig.audioQuality]);

    const handleServerMessage = useCallback((message: any) => {
        const startTime = Date.now();
        log(`Received: ${message.type}`);

        switch (message.type) {
            case 'session.created':
                sessionIdRef.current = message.session.id;
                setSessionInfo({
                    id: message.session.id,
                    model: message.session.model || 'Whisper'
                });
                log(`Session created: ${message.session.id}`, 'success');
                break;

            case 'session.updated':
                log('Session configuration updated', 'success');
                break;

            case 'input_audio_buffer.committed':
                log('Audio buffer committed for processing', 'success');
                setProcessing(true);
                break;

            case 'response.created':
                log(`Response created: ${message.response.id}`, 'success');
                break;

            case 'response.audio.delta':
                log('Received audio response delta');
                break;

            case 'response.done':
                const responseTime = Date.now() - startTime;
                latencySumRef.current += responseTime;
                latencyCountRef.current++;

                setProcessing(false);
                hasSpeechInBufferRef.current = false;

                if (message.response.output && message.response.output.length > 0) {
                    const content = message.response.output[0].content;
                    if (content && content.length > 0 && content[0].text) {
                        const transcribedText = content[0].text;
                        setTranscription(transcribedText);
                        setCommand(transcribedText);
                        setCommandHistory(prev => [transcribedText, ...prev.slice(0, 9)]);

                        if (message.response.usage) {
                            setConfidenceIndicator(`(${message.response.usage.total_tokens} tokens)`);
                        }

                        processVoiceCommand(transcribedText);
                    }
                }

                log(`Transcription completed in ${responseTime}ms`, 'success');
                updateStats();
                break;

            case 'error':
                log(`Server error: ${message.error.message}`, 'error');
                setProcessing(false);
                setResult({
                    success: false,
                    message: `Server error: ${message.error.message}`
                });
                break;

            default:
                log(`Unknown message type: ${message.type}`, 'warning');
        }
    }, [log, setCommand, setCommandHistory, setResult]);

    const updateStats = useCallback(() => {
        setAudioStats({
            totalChunks: chunkCounterRef.current,
            totalBytes: totalBytesRef.current,
            latencySum: latencySumRef.current,
            latencyCount: latencyCountRef.current,
            bufferSize: audioBufferRef.current.length / (audioConfig.audioQuality * 2)
        });
    }, [audioConfig.audioQuality]);

    const processVoiceCommand = async (command: string) => {
        if (!command.trim()) {
            setResult({
                success: false,
                message: "No speech detected. Please try again."
            });
            return;
        }

        setIsProcessing(true);
        try {
            setResult({
                success: true,
                message: `Voice command processed: "${command}"`
            });
            log(`Voice command executed: "${command}"`, 'success');
        } catch (error) {
            setResult({
                success: false,
                message: `Voice command execution failed: ${error}`
            });
            log(`Voice command failed: ${error}`, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const connect = async () => {
        try {
            const url = audioConfig.serverUrl;
            log(`Connecting to ${url}...`);

            wsRef.current = new WebSocket(url);

            wsRef.current.onopen = () => {
                setIsConnected(true);
                log('Connected to WebSocket server', 'success');
            };

            wsRef.current.onmessage = (event) => {
                handleServerMessage(JSON.parse(event.data));
            };

            wsRef.current.onclose = (event) => {
                setIsConnected(false);
                setIsRecording(false);
                setProcessing(false);
                log(`Connection closed: ${event.code} - ${event.reason}`, 'warning');
            };

            wsRef.current.onerror = (error) => {
                log('WebSocket error occurred', 'error');
                console.error('WebSocket error:', error);
            };

        } catch (error) {
            log(`Connection failed: ${error}`, 'error');
        }
    };

    const disconnect = () => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
        }
        if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.disconnect();
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }
        setIsConnected(false);
        setIsRecording(false);
        setProcessing(false);
        setSleeping(false);
    };

    const startRecording = () => {
        setIsRecording(true);
    };

    const createAudioWorkletProcessor = () => {
        // Create the audio worklet processor code as a Blob URL
        const processorCode = `
            class AudioProcessorWorklet extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.bufferSize = 4096;
                    this.buffer = new Float32Array(this.bufferSize);
                    this.bufferIndex = 0;
                }

                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const channelData = input[0];
                        
                        for (let i = 0; i < channelData.length; i++) {
                            this.buffer[this.bufferIndex] = channelData[i];
                            this.bufferIndex++;
                            
                            if (this.bufferIndex >= this.bufferSize) {
                                // Send buffer to main thread
                                this.port.postMessage({
                                    type: 'audio-data',
                                    audioData: new Float32Array(this.buffer)
                                });
                                
                                // Reset buffer
                                this.bufferIndex = 0;
                                this.buffer.fill(0);
                            }
                        }
                    }
                    
                    return true;
                }
            }

            registerProcessor('audio-processor-worklet', AudioProcessorWorklet);
        `;

        const blob = new Blob([processorCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    };

    const startAudioProcessing = async () => {
        try {
            log('Requesting microphone access...');

            const sampleRate = audioConfig.audioQuality;

            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: sampleRate,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: sampleRate
            });

            // Create and load the audio worklet processor
            const processorUrl = createAudioWorkletProcessor();

            try {
                await audioContextRef.current.audioWorklet.addModule(processorUrl);
                log('Audio worklet processor loaded successfully');
            } catch (error) {
                log(`Failed to load audio worklet: ${error}`, 'error');
                // Fallback to a simpler approach using AnalyserNode
                await startAudioProcessingFallback();
                return;
            }

            const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);

            // Create AudioWorkletNode
            audioWorkletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor-worklet');

            // Handle messages from the audio worklet processor
            audioWorkletNodeRef.current.port.onmessage = (event) => {
                if (event.data.type === 'audio-data') {
                    if (isRecording && !isProcessingAudioRef.current) {
                        processAudioData(event.data.audioData);
                    }
                }
            };

            source.connect(audioWorkletNodeRef.current);

            hasSpeechInBufferRef.current = false;
            lastSpeechTimeRef.current = Date.now();
            log('Recording started with AudioWorklet', 'success');

            // Start sending audio chunks
            startAudioChunking();

            // Clean up the blob URL
            URL.revokeObjectURL(processorUrl);
        } catch (error) {
            log(`Failed to start recording: ${error}`, 'error');
        }
    };

    // Fallback method using AnalyserNode for browsers that don't support AudioWorklet
    const startAudioProcessingFallback = async () => {
        try {
            log('Using AnalyserNode fallback for audio processing');

            const source = audioContextRef.current!.createMediaStreamSource(mediaStreamRef.current!);
            const analyser = audioContextRef.current!.createAnalyser();

            analyser.fftSize = 4096;
            const bufferLength = analyser.fftSize;
            const dataArray = new Float32Array(bufferLength);

            source.connect(analyser);

            const processAudio = () => {
                if (isRecording) {
                    analyser.getFloatTimeDomainData(dataArray);

                    if (!isProcessingAudioRef.current) {
                        processAudioData(dataArray);
                    }

                    requestAnimationFrame(processAudio);
                }
            };

            requestAnimationFrame(processAudio);

            hasSpeechInBufferRef.current = false;
            lastSpeechTimeRef.current = Date.now();
            log('Recording started with AnalyserNode fallback', 'success');

            // Start sending audio chunks
            startAudioChunking();
        } catch (error) {
            log(`Failed to start fallback audio processing: ${error}`, 'error');
        }
    };

    const stopRecording = () => {
        setIsRecording(false);

        if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.disconnect();
            audioWorkletNodeRef.current = null;
        }

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
        }

        setSleeping(false);
        setProcessing(false);
        log('Recording stopped', 'warning');
    };

    const startAudioChunking = () => {
        const chunkIntervalMs = audioConfig.chunkSize;
        const sampleRate = audioConfig.audioQuality;
        const samplesPerChunk = Math.floor(sampleRate * chunkIntervalMs / 1000);

        const sendChunk = () => {
            if (isRecording) {
                // Only send chunks if not processing and not sleeping (or if we have significant audio)
                if (!isProcessingAudioRef.current && !isSleepingRef.current && audioBufferRef.current.length >= samplesPerChunk) {
                    const chunk = audioBufferRef.current.splice(0, samplesPerChunk);
                    sendAudioChunk(chunk);
                }

                // Schedule next chunk with adaptive interval
                let nextInterval = chunkIntervalMs;
                if (isSleepingRef.current) {
                    nextInterval = Math.max(chunkIntervalMs * 4, 1000);
                } else if (isProcessingAudioRef.current) {
                    nextInterval = Math.min(chunkIntervalMs, 100);
                }

                setTimeout(sendChunk, nextInterval);
            }
        };

        setTimeout(sendChunk, chunkIntervalMs);
    };

    const sendAudioChunk = (pcmData: number[]) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isProcessingAudioRef.current) {
            return;
        }

        // Convert to Int16Array and then to bytes
        const int16Data = new Int16Array(pcmData);
        const bytes = new Uint8Array(int16Data.length * 2);
        for (let i = 0; i < int16Data.length; i++) {
            bytes[i * 2] = int16Data[i] & 0xFF;
            bytes[i * 2 + 1] = (int16Data[i] >> 8) & 0xFF;
        }

        const base64Audio = btoa(String.fromCharCode.apply(null, Array.from(bytes)));

        const event = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
        };

        wsRef.current.send(JSON.stringify(event));

        chunkCounterRef.current++;
        totalBytesRef.current += bytes.length;
        updateStats();
    };

    const commitAudioBuffer = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isProcessingAudioRef.current) {
            log('Cannot commit: not connected or already processing', 'warning');
            return;
        }

        if (audioBufferRef.current.length === 0) {
            log('No audio data to commit', 'warning');
            return;
        }

        // Send any remaining audio first
        if (audioBufferRef.current.length > 0) {
            sendAudioChunk(audioBufferRef.current.splice(0));
        }

        const event = {
            type: 'input_audio_buffer.commit'
        };

        wsRef.current.send(JSON.stringify(event));
        log('Audio buffer committed for transcription');

        setProcessing(true);
        hasSpeechInBufferRef.current = false;

        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
        }
    };

    const clearAudioBuffer = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
        }

        audioBufferRef.current = [];
        hasSpeechInBufferRef.current = false;

        const event = {
            type: 'input_audio_buffer.clear'
        };

        wsRef.current.send(JSON.stringify(event));
        log('Audio buffer cleared');

        if (isProcessingAudioRef.current) {
            setProcessing(false);
        }

        updateStats();
    };

    const AudioVisualizer = () => (
        <div className={`relative h-16 rounded-lg overflow-hidden transition-all duration-200 ${
            isProcessingAudioRef.current ? 'bg-purple-600' : isSleepingRef.current ? 'bg-teal-600 opacity-60' : 'bg-gray-800'
        } ${isProcessingAudioRef.current ? 'animate-pulse' : ''}`}>
            {audioLevelHistoryRef.current.map((level, i) => (
                <div
                    key={i}
                    className={`absolute bottom-0 w-1 transition-all duration-100 rounded-t-sm ${
                        isProcessingAudioRef.current ? 'bg-gradient-to-t from-purple-400 to-purple-200' :
                            isSleepingRef.current ? 'bg-gradient-to-t from-gray-600 to-gray-400' :
                                'bg-gradient-to-t from-blue-500 to-blue-300'
                    }`}
                    style={{
                        left: `${i * 4}px`,
                        height: `${Math.max(level, 2)}px`
                    }}
                />
            ))}
        </div>
    );

    const getRecordingStatus = () => {
        if (isProcessingAudioRef.current) return 'Processing';
        if (isRecording && isSleepingRef.current) return 'Recording (Sleeping)';
        if (isRecording) return 'Recording';
        return 'Idle';
    };

    const getStatusIndicatorClass = () => {
        if (isProcessingAudioRef.current) return 'bg-purple-500';
        if (isRecording && isSleepingRef.current) return 'bg-teal-500';
        if (isRecording) return 'bg-orange-500';
        return 'bg-gray-400';
    };

    const getAvgLatency = () => {
        return audioStats.latencyCount > 0 ? Math.round(audioStats.latencySum / audioStats.latencyCount) : 0;
    };

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
                <h1 className="text-4xl font-light text-gray-700 dark:text-gray-300 mb-4">
                    Real-Time Audio Streaming Client
                </h1>
            </div>

            <div
                className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm bg-opacity-95 dark:bg-opacity-95">
                {/* Configuration Panel */}
                <div
                    className="bg-gray-50 dark:bg-gray-700 p-5 rounded-xl mb-6 border border-gray-200 dark:border-gray-600">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Configuration</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                            <label
                                className="block text-sm font-semibold mb-2 min-w-32 text-gray-700 dark:text-gray-300">Server
                                URL:</label>
                            <input
                                type="text"
                                value={audioConfig.serverUrl}
                                onChange={(e) => setAudioConfig(prev => ({...prev, serverUrl: e.target.value}))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                disabled={isConnected}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Chunk
                                Size (ms):</label>
                            <select
                                value={audioConfig.chunkSize}
                                onChange={(e) => setAudioConfig(prev => ({
                                    ...prev,
                                    chunkSize: parseInt(e.target.value)
                                }))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                disabled={isConnected}
                            >
                                <option value={100}>100ms</option>
                                <option value={250}>250ms</option>
                                <option value={500}>500ms</option>
                                <option value={1000}>1000ms</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Audio
                                Quality:</label>
                            <select
                                value={audioConfig.audioQuality}
                                onChange={(e) => setAudioConfig(prev => ({
                                    ...prev,
                                    audioQuality: parseInt(e.target.value)
                                }))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                disabled={isConnected}
                            >
                                <option value={16000}>16kHz (Recommended)</option>
                                <option value={22050}>22.05kHz</option>
                                <option value={44100}>44.1kHz</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Silence
                                Threshold:</label>
                            <select
                                value={audioConfig.silenceThreshold}
                                onChange={(e) => setAudioConfig(prev => ({
                                    ...prev,
                                    silenceThreshold: parseFloat(e.target.value)
                                }))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            >
                                <option value={0.001}>Very Sensitive</option>
                                <option value={0.005}>Normal</option>
                                <option value={0.01}>Less Sensitive</option>
                                <option value={0.02}>Least Sensitive</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Auto-commit
                                after silence:</label>
                            <select
                                value={audioConfig.autoCommitDelay}
                                onChange={(e) => setAudioConfig(prev => ({
                                    ...prev,
                                    autoCommitDelay: parseInt(e.target.value)
                                }))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            >
                                <option value={1000}>1 second</option>
                                <option value={1500}>1.5 seconds</option>
                                <option value={2000}>2 seconds</option>
                                <option value={3000}>3 seconds</option>
                                <option value={0}>Disabled</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap gap-4 justify-center mb-8">
                    <button
                        onClick={isConnected ? disconnect : connect}
                        disabled={isProcessing}
                        className={`px-6 py-3 rounded-full font-semibold text-lg transition-all duration-300 transform hover:scale-105 relative overflow-hidden ${
                            isConnected
                                ? 'bg-gradient-to-r from-red-500 to-yellow-500 text-white hover:shadow-lg'
                                : 'bg-gradient-to-r from-green-500 to-green-600 text-white hover:shadow-lg'
                        }`}
                    >
                        {isConnected ? 'Disconnect' : 'Connect to Server'}
                    </button>
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={!isConnected || isProcessing}
                        className={`px-6 py-3 rounded-full font-semibold text-lg transition-all duration-300 transform hover:scale-105 relative overflow-hidden ${
                            isProcessingAudioRef.current
                                ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white animate-pulse'
                                : isRecording
                                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white animate-pulse hover:shadow-lg'
                                    : 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:shadow-lg'
                        }`}
                    >
                        {isProcessingAudioRef.current ? 'Processing...' : isRecording ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button
                        onClick={commitAudioBuffer}
                        disabled={!isConnected || audioStats.bufferSize === 0 || isProcessingAudioRef.current}
                        className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold text-lg hover:shadow-lg transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
                    >
                        Commit Audio
                    </button>
                    <button
                        onClick={clearAudioBuffer}
                        disabled={!isConnected || (audioStats.bufferSize === 0 && !isProcessingAudioRef.current)}
                        className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold text-lg hover:shadow-lg transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
                    >
                        Clear Buffer
                    </button>
                </div>

                {/* Status Panel */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
                    <div
                        className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 p-5 rounded-xl border-l-4 border-blue-500">
                        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 text-lg">Connection
                            Status</h3>
                        <div className="flex items-center gap-3 mb-2">
                            <span
                                className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                            <span
                                className="text-gray-700 dark:text-gray-300">{isConnected ? 'Connected' : 'Disconnected'}</span>
                        </div>
                        {sessionInfo && (
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                Session: {sessionInfo.id.substring(0, 8)}... | Model: {sessionInfo.model}
                            </div>
                        )}
                    </div>

                    <div
                        className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 p-5 rounded-xl border-l-4 border-blue-500">
                        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 text-lg">Recording
                            Status</h3>
                        <div className="flex items-center gap-3 mb-2">
                            <span className={`w-3 h-3 rounded-full ${getStatusIndicatorClass()}`}></span>
                            <span className="text-gray-700 dark:text-gray-300">{getRecordingStatus()}</span>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                            Level: {(20 * Math.log10(audioLevel + 1e-10)).toFixed(1)}dB |
                            Samples: {audioBufferRef.current.length} | {isSleepingRef.current ? 'Sleeping' : isProcessingAudioRef.current ? 'Processing' : 'Active'}
                            {silenceDetected && <span className="ml-2 text-teal-600">Silence detected</span>}
                        </div>
                    </div>
                </div>

                {/* Transcription Panel */}
                <div
                    className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900 dark:to-cyan-900 p-6 rounded-xl mb-6 min-h-40 bg-opacity-70 dark:bg-opacity-30">
                    <h3 className="flex items-center gap-3 mb-4 text-blue-800 dark:text-blue-200 font-semibold text-lg">
                        Live Transcription
                        {confidenceIndicator && (
                            <span className="text-sm text-blue-600 dark:text-blue-400">{confidenceIndicator}</span>
                        )}
                        {silenceDetected && (
                            <span
                                className="text-sm text-teal-600 dark:text-teal-400 opacity-100 transition-opacity duration-300">
                                Silence detected
                            </span>
                        )}
                    </h3>
                    <div
                        className={`text-lg leading-relaxed text-gray-800 dark:text-gray-200 p-4 rounded-lg min-h-20 whitespace-pre-wrap ${
                            isProcessingAudioRef.current
                                ? 'bg-purple-100 dark:bg-purple-900 bg-opacity-70 border-2 border-dashed border-purple-400'
                                : 'bg-white dark:bg-gray-800 bg-opacity-70'
                        }`}>
                        {transcription}
                    </div>

                    <AudioVisualizer/>
                </div>

                {/* Statistics */}
                <div className="flex justify-around bg-gray-100 dark:bg-gray-700 p-4 rounded-lg mb-6 flex-wrap gap-4">
                    <div className="text-center">
                        <div
                            className="text-2xl font-bold text-gray-800 dark:text-gray-200">{audioStats.totalChunks}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 uppercase">Chunks Sent</div>
                    </div>
                    <div className="text-center">
                        <div
                            className="text-2xl font-bold text-gray-800 dark:text-gray-200">{formatBytes(audioStats.totalBytes)}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 uppercase">Total Bytes</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{getAvgLatency()}ms</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 uppercase">Avg Latency</div>
                    </div>
                    <div className="text-center">
                        <div
                            className="text-2xl font-bold text-gray-800 dark:text-gray-200">{audioStats.bufferSize.toFixed(1)}s
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 uppercase">Buffer Size</div>
                    </div>
                </div>

                {/* Logs Panel */}
                <div
                    className="bg-gray-900 text-gray-100 p-5 rounded-xl max-h-80 overflow-y-auto font-mono text-sm leading-relaxed">
                    {logs.map((logEntry, index) => (
                        <div key={index} className="mb-1 p-0.5">
                            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                                logEntry.type === 'info' ? 'bg-blue-400' :
                                    logEntry.type === 'success' ? 'bg-green-400' :
                                        logEntry.type === 'warning' ? 'bg-yellow-400' :
                                            'bg-red-400'
                            }`}></span>
                            <span className={`${
                                logEntry.type === 'info' ? 'text-blue-400' :
                                    logEntry.type === 'success' ? 'text-green-400' :
                                        logEntry.type === 'warning' ? 'text-yellow-400' :
                                            'text-red-400'
                            }`}>
                                [{logEntry.type.toUpperCase()}]
                            </span>
                            <span className="text-gray-300 ml-2">{logEntry.message}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}