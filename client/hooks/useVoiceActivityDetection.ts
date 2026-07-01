import { useEffect, useRef, useState } from 'react';

interface UseVoiceActivityDetectionProps {
  analyserNode: AnalyserNode | null;
  isRecording: boolean;
  threshold?: number; // Normalized RMS volume threshold (0.0 to 1.0)
  silenceTimeoutMs?: number; // Time in milliseconds before triggering speech end (default: 1000ms)
  onSilenceDetected: () => void;
}

/**
 * A reusable hook to calculate real-time microphone volume levels (Root Mean Square)
 * and trigger a callback if silence persists beyond a certain duration.
 * This saves bandwidth and controls cost by stopping the Speech-To-Text pipeline.
 */
export function useVoiceActivityDetection({
  analyserNode,
  isRecording,
  threshold = 0.015, // Threshold below which signal is considered silence
  silenceTimeoutMs = 1000,
  onSilenceDetected,
}: UseVoiceActivityDetectionProps) {
  const [isSilent, setIsSilent] = useState(true);
  const [rmsVolume, setRmsVolume] = useState(0);
  
  // Track consecutive silence duration
  const silenceStartRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);

  // Store the latest callback in a ref to avoid effect restart loops when defined inline
  const callbackRef = useRef(onSilenceDetected);
  useEffect(() => {
    callbackRef.current = onSilenceDetected;
  }, [onSilenceDetected]);

  useEffect(() => {
    if (!isRecording || !analyserNode) {
      setIsSilent(true);
      setRmsVolume(0);
      silenceStartRef.current = null;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const bufferLength = analyserNode.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    const checkAudio = () => {
      if (!isRecording || !analyserNode) return;

      // 1. Fetch time-domain waveform data (oscilloscope style)
      analyserNode.getByteTimeDomainData(dataArray);

      // 2. Compute Root Mean Square (RMS) volume
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        // Shift range from [0, 255] to [-1.0, 1.0]
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / bufferLength);
      setRmsVolume(rms);

      // 3. Evaluate Speech vs. Silence
      const now = Date.now();
      const nextSilent = rms < threshold;

      // Only trigger state updates when the value changes to reduce re-renders
      setIsSilent((prev) => {
        if (prev !== nextSilent) return nextSilent;
        return prev;
      });

      if (nextSilent) {
        // Start counting silence duration
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now;
        } else {
          const silenceDuration = now - silenceStartRef.current;
          if (silenceDuration >= silenceTimeoutMs) {
            console.log(`[VAD] Silence detected for ${silenceDuration}ms. Triggering speech end callback.`);
            callbackRef.current();
            silenceStartRef.current = null; // Reset
            return; // Exit loop
          }
        }
      } else {
        silenceStartRef.current = null; // Reset silence clock
      }

      // Loop frame check
      animationRef.current = requestAnimationFrame(checkAudio);
    };

    // Begin loop
    checkAudio();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isRecording, analyserNode, threshold, silenceTimeoutMs]);

  return {
    isSilent,
    rmsVolume,
  };
}
export default useVoiceActivityDetection;
