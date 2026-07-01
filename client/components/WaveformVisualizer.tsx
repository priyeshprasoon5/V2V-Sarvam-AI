'use client';

import { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  analyserNode: AnalyserNode | null;
  isRecording: boolean;
}

/**
 * WaveformVisualizer renders a beautiful dual-layered canvas waveform.
 * Renders a slow, futuristic idle wave when not recording or quiet,
 * and tracks actual mic frequency data in real time when active.
 */
export function WaveformVisualizer({ analyserNode, isRecording }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  
  // Phase tracker for idle animation movement
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI displays by scaling canvas
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Prepare variables for data fetching
    let bufferLength = analyserNode ? analyserNode.frequencyBinCount : 0;
    let dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;

      // 1. Clear background with subtle trail (gives a futuristic motion-blur effect)
      ctx.fillStyle = 'rgba(3, 0, 20, 0.2)';
      ctx.fillRect(0, 0, width, height);

      // Draw faint gridlines in background
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.03)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // If active and we have an AnalyserNode, draw mic wave
      if (isRecording && analyserNode) {
        bufferLength = analyserNode.frequencyBinCount;
        if (dataArray.length !== bufferLength) {
          dataArray = new Uint8Array(bufferLength);
        }
        
        analyserNode.getByteTimeDomainData(dataArray);

        // --- LAYER 1: Deep Purple Background Shadow Wave ---
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)'; // neon purple
        
        let sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0; // Normalized between 0 and 2
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        // --- LAYER 2: Bright Neon Cyan Glowing Foreground Wave ---
        ctx.beginPath();
        ctx.lineWidth = 2.5;
        // Create dynamic gradient across canvas
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#06b6d4'); // Cyan
        gradient.addColorStop(0.5, '#22d3ee'); // Bright Cyan
        gradient.addColorStop(1, '#a855f7'); // Purple
        
        ctx.strokeStyle = gradient;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(6, 182, 212, 0.8)';

        x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          // Add a tiny bit of bezier smoothing
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            const prevX = x - sliceWidth;
            const prevV = dataArray[i - 1] / 128.0;
            const prevY = (prevV * height) / 2;
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
          }
          x += sliceWidth;
        }
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        
        // Reset shadow settings
        ctx.shadowBlur = 0;
      } else {
        // --- IDLE WAVE ANIMATION (CSS/JS simulated) ---
        // Renders multiple overlapping glowing sine waves that slowly slide
        phaseRef.current += 0.05;
        const phase = phaseRef.current;

        // Draw 3 layers of sine waves
        const waves = [
          { amplitude: 12, frequency: 0.015, phaseShift: 0, color: 'rgba(168, 85, 247, 0.15)', width: 1.5 }, // Purple
          { amplitude: 8, frequency: 0.025, phaseShift: Math.PI / 2, color: 'rgba(6, 182, 212, 0.25)', width: 2 }, // Cyan
          { amplitude: 4, frequency: 0.035, phaseShift: Math.PI, color: 'rgba(6, 182, 212, 0.6)', width: 1 } // Bright Cyan
        ];

        waves.forEach((w) => {
          ctx.beginPath();
          ctx.lineWidth = w.width;
          ctx.strokeStyle = w.color;
          
          if (w.width === 1) {
            ctx.shadowBlur = 4;
            ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
          }

          for (let x = 0; x < width; x++) {
            const y = height / 2 + Math.sin(x * w.frequency + phase + w.phaseShift) * w.amplitude;
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
          ctx.shadowBlur = 0; // Reset
        });
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [analyserNode, isRecording]);

  return (
    <div className="relative w-full h-32 rounded-xl overflow-hidden border border-glass-border bg-dark-bg/60 shadow-inner">
      {/* Background radial highlight */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.04)_0%,transparent_70%)] pointer-events-none" />
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
export default WaveformVisualizer;
