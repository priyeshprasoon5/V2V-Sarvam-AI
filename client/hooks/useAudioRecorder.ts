import { useState, useRef, useEffect, useCallback } from 'react';

interface UseAudioRecorderProps {
  chunkIntervalMs?: number; // Maintained for interface compatibility, ScriptProcessor uses buffer size instead
  onAudioChunk: (base64Data: string, chunkIndex: number) => void;
}

/**
 * A custom React hook that handles:
 * 1. Requesting microphone permissions.
 * 2. Setting up the Web Audio API (AudioContext + AnalyserNode) for visual feedback.
 * 3. Initializing a ScriptProcessorNode to capture raw PCM S16LE 16kHz audio chunks.
 * 4. Converting raw PCM to Base64 and exporting them via callback.
 */
export function useAudioRecorder({ onAudioChunk }: UseAudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState(0);

  // References to Web Audio API elements for cleanup
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Track chunk counts locally to avoid closure issues in callbacks
  const chunkIndexRef = useRef(0);

  /**
   * Starts recording microphone input.
   */
  const startRecording = useCallback(async () => {
    setError(null);
    setChunkCount(0);
    chunkIndexRef.current = 0;

    try {
      // 1. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1, // Mono is preferred for STT
        },
      });

      streamRef.current = stream;

      // 2. Initialize Web Audio API at 16000Hz (auto-resamples mic to 16kHz)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      
      // Setup AnalyserNode for visualizer analysis
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 3. Setup ScriptProcessorNode for raw PCM extraction (buffer size 4096 at 16kHz is ~256ms)
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0); // Float32Array mono
        
        // Convert Float32 [-1.0, 1.0] to Int16 PCM [-32768, 32767]
        const pcmBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmBuffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert PCM Int16 buffer to Base64 string safely
        const uint8Array = new Uint8Array(pcmBuffer.buffer);
        let binary = '';
        const len = uint8Array.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64String = btoa(binary);

        const currentIdx = chunkIndexRef.current;
        chunkIndexRef.current += 1;
        setChunkCount((prev) => prev + 1);
        onAudioChunk(base64String, currentIdx);
      };

      // Connect pipeline
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      setIsRecording(true);
      console.log(`[useAudioRecorder] Mic recording started using ScriptProcessor (PCM S16LE 16kHz).`);
    } catch (err: any) {
      console.error('[useAudioRecorder] Error accessing microphone:', err);
      setError(err.message || 'Microphone access denied or unsupported.');
      setIsRecording(false);
    }
  }, [onAudioChunk]);

  /**
   * Stops recording and cleans up all active audio resources.
   */
  const stopRecording = useCallback(() => {
    console.log('[useAudioRecorder] Stopping mic recording...');
    
    // Stop ScriptProcessor
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    // Stop all audio track streams
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsRecording(false);
  }, []);

  // Cleanup hooks on unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, [isRecording, stopRecording]);

  return {
    isRecording,
    error,
    chunkCount,
    startRecording,
    stopRecording,
    analyserNode: analyserRef.current,
  };
}
export default useAudioRecorder;
