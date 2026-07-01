'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useVoiceActivityDetection } from '../hooks/useVoiceActivityDetection';
import { WaveformVisualizer } from './WaveformVisualizer';
import { formatBytes } from '../lib/utils';
import { ClientMessage } from '../types/websocket';
import { AudioQueue } from '../services/audioQueue';

// Supported BCP-47 regional languages for Sarvam AI Saaras v3 STT
const SUPPORTED_LANGUAGES = [
  { label: '✨ Auto Select', value: 'auto' },
  { label: 'English (India)', value: 'en-IN' },
  { label: 'Hindi (हिंदी)', value: 'hi-IN' },
  { label: 'Hinglish (Hindi + English)', value: 'hi-IN' },
  { label: 'Bengali (বাংলা)', value: 'bn-IN' },
  { label: 'Marathi (मराठी)', value: 'mr-IN' },
  { label: 'Telugu (తెలుగు)', value: 'te-IN' },
  { label: 'Tamil (தமிழ்)', value: 'ta-IN' },
  { label: 'Gujarati (ગુજરાતી)', value: 'gu-IN' },
  { label: 'Kannada (ಕನ್ನಡ)', value: 'kn-IN' },
  { label: 'Malayalam (മലയാളം)', value: 'ml-IN' },
  { label: 'Punjabi (ਪੰਜਾਬੀ)', value: 'pa-IN' },
  { label: 'Odia (ଓଡ଼ିଆ)', value: 'or-IN' },
  { label: 'Urdu (اردو)', value: 'ur-IN' },
  { label: 'Assamese (অसमীয়া)', value: 'as-IN' },
  { label: 'Maithili (मैथिली)', value: 'mai-IN' },
];

/**
 * Main dashboard for the Real-Time V2V Voice AI Assistant.
 * Fully integrates STT, LLM streaming, TTS synthesis, gapless audio queue playback,
 * and double-triggered interruption handling.
 */
export function VoiceAssistant() {
  const [totalStreamedBytes, setTotalStreamedBytes] = useState(0);
  
  // --- States ---
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscripts, setFinalTranscripts] = useState<string[]>([]);
  const [sttStatus, setSttStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'stopped'>('disconnected');
  const [isVadEnabled, setIsVadEnabled] = useState(true);

  // V2V States
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiResponseText, setAiResponseText] = useState('');
  const [playbackStatus, setPlaybackStatus] = useState<'idle' | 'thinking' | 'speaking' | 'interrupted'>('idle');
  const [interruptedBadge, setInterruptedBadge] = useState(false);

  // Latency Metrics States
  const [sttLatency, setSttLatency] = useState<number>(0);
  const [llmFirstTokenLatency, setLlmFirstTokenLatency] = useState<number>(0);
  const [totalTurnLatency, setTotalTurnLatency] = useState<number>(0);

  const transcriptsEndRef = useRef<HTMLDivElement | null>(null);
  const responseEndRef = useRef<HTMLDivElement | null>(null);
  
  // Track latency timestamps
  const turnStartTimeRef = useRef<number | null>(null);

  // 1. Initialize Audio Queue Player
  const audioQueue = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new AudioQueue((playing) => {
      setIsAiSpeaking(playing);
      if (playing) {
        setPlaybackStatus('speaking');
      } else {
        setPlaybackStatus('idle');
      }
    });
  }, []);

  // 2. WebSocket Endpoint Resolution
  const WS_URL = useMemo(() => {
    return process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:5000/ws';
  }, []);

  // 3. Hook up WebSocket client
  const ws = useWebSocket({
    url: WS_URL,
    onMessageReceived: (msg) => {
      switch (msg.type) {
        case 'stt:partial':
          setPartialTranscript(msg.transcript);
          break;

        case 'stt:final':
          setFinalTranscripts((prev) => [...prev, msg.transcript]);
          setPartialTranscript('');
          if (msg.latencyMs !== undefined) {
            setSttLatency(msg.latencyMs);
          }
          // Reset turn timer for LLM & TTS latency tracking
          turnStartTimeRef.current = Date.now();
          break;

        case 'llm:start':
          setIsAiThinking(true);
          setAiResponseText('');
          setInterruptedBadge(false);
          setPlaybackStatus('thinking');
          setLlmFirstTokenLatency(0);
          setTotalTurnLatency(0);
          break;

        case 'llm:token':
          setIsAiThinking(false);
          setAiResponseText((prev) => prev + msg.token);
          if (turnStartTimeRef.current && llmFirstTokenLatency === 0) {
            setLlmFirstTokenLatency(Date.now() - turnStartTimeRef.current);
          }
          break;

        case 'llm:complete':
          setIsAiThinking(false);
          break;

        case 'llm:error':
          console.error('[VoiceAssistant] LLM service error:', msg.message);
          setIsAiThinking(false);
          setPlaybackStatus('idle');
          break;

        case 'audio:start':
          setPlaybackStatus('speaking');
          break;

        case 'audio:chunk':
          // Feed synthesized chunk into the gapless AudioQueue
          if (audioQueue) {
            console.log('[VoiceAssistant] Received audio chunk payload length:', msg.payload.length);
            audioQueue.enqueueChunk(msg.payload);
          }
          if (turnStartTimeRef.current && totalTurnLatency === 0) {
            setTotalTurnLatency(Date.now() - turnStartTimeRef.current);
          }
          break;

        case 'audio:end':
          // The server finished sending, playbackStatus will transition to idle when AudioQueue finishes
          break;

        case 'interruption:complete':
          console.log('[VoiceAssistant] Interruption finalized on server.');
          setPlaybackStatus('interrupted');
          setInterruptedBadge(true);
          break;

        case 'stt:status':
          setSttStatus(msg.status);
          break;

        case 'stt:error':
          console.error('[VoiceAssistant] STT service error:', msg.message);
          setSttStatus('disconnected');
          break;

        default:
          break;
      }
    },
  });

  // 4. Hook up Microphone Audio Recorder
  const {
    isRecording,
    error: recorderError,
    chunkCount,
    startRecording,
    stopRecording,
    analyserNode,
  } = useAudioRecorder({
    chunkIntervalMs: 200,
    onAudioChunk: (base64Payload, chunkIndex) => {
      const sizeInBytes = Math.floor((base64Payload.length * 3) / 4);
      setTotalStreamedBytes((prev) => prev + sizeInBytes);

      ws.send({
        type: 'stt:audio',
        sessionId: ws.sessionId,
        timestamp: new Date().toISOString(),
        payload: base64Payload,
        chunkIndex,
      });
    },
  });

  // 5. Hook up Voice Activity Detection (VAD)
  const { isSilent, rmsVolume } = useVoiceActivityDetection({
    analyserNode,
    isRecording,
    threshold: 0.015,
    silenceTimeoutMs: 1000,
    onSilenceDetected: () => {
      if (isVadEnabled) {
        console.log('[VAD] Silence threshold hit. Auto-stopping voice stream.');
        handleStopRecording();
      }
    },
  });

  // 6. Handle active user interruption (voice-triggered or button-triggered)
  const triggerInterruption = () => {
    console.log('[VoiceAssistant] Triggering interruption');
    
    // Stop active audio playback locally
    if (audioQueue) {
      audioQueue.stop();
    }
    setIsAiSpeaking(false);
    setIsAiThinking(false);
    setPlaybackStatus('interrupted');
    setInterruptedBadge(true);

    // Notify backend to cancel active LLM / TTS streams
    ws.send({
      type: 'interruption:start',
      sessionId: ws.sessionId,
      timestamp: new Date().toISOString(),
    });
  };

  // Keyboard interruption (Spacebar) listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (isAiSpeaking || isAiThinking)) {
        e.preventDefault();
        triggerInterruption();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAiSpeaking, isAiThinking, audioQueue]);

  // Voice-triggered interruption: user speaks while AI is generating or speaking
  useEffect(() => {
    if (isRecording && !isSilent && (isAiSpeaking || isAiThinking)) {
      console.log('[Interruption] User speech detected. Interrupting AI.');
      triggerInterruption();
    }
  }, [isSilent, isRecording, isAiSpeaking, isAiThinking]);

  // Auto-scroll disabled to keep view stable
  // useEffect(() => {
  //   transcriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  // }, [finalTranscripts, partialTranscript]);

  // Auto-scroll disabled to keep view stable
  // useEffect(() => {
  //   responseEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  // }, [aiResponseText]);

  // Auto-stop recording on WebSocket disconnect
  useEffect(() => {
    if (ws.status !== 'connected' && isRecording) {
      console.warn('[VoiceAssistant] WS disconnected. Auto-halting recorder.');
      stopRecording();
      setSttStatus('disconnected');
    }
  }, [ws.status, isRecording, stopRecording]);

  const handleStartRecording = async () => {
    if (ws.status !== 'connected') {
      alert('Please connect to the WebSocket server before streaming audio.');
      return;
    }

    // Stop any remaining playback if restarting recording
    if (audioQueue) {
      audioQueue.stop();
    }
    setIsAiSpeaking(false);
    setIsAiThinking(false);
    setPlaybackStatus('idle');

    setPartialTranscript('');
    setAiResponseText('');
    
    const startEvent: ClientMessage = {
      type: 'stt:start',
      sessionId: ws.sessionId,
      timestamp: new Date().toISOString(),
      language: selectedLanguage,
      model: 'saaras:v3',
    } as any;
    
    const sent = ws.send(startEvent);
    if (sent) {
      setTotalStreamedBytes(0);
      setSttLatency(0);
      setLlmFirstTokenLatency(0);
      setTotalTurnLatency(0);
      await startRecording();
    }
  };

  const handleStopRecording = () => {
    stopRecording();
    const stopEvent: ClientMessage = {
      type: 'stt:stop',
      sessionId: ws.sessionId,
      timestamp: new Date().toISOString(),
    } as any;
    ws.send(stopEvent);
  };

  const copySessionId = () => {
    if (ws.sessionId) {
      navigator.clipboard.writeText(ws.sessionId);
      alert('Session ID copied to clipboard!');
    }
  };

  const clearTranscripts = () => {
    setFinalTranscripts([]);
    setPartialTranscript('');
    setAiResponseText('');
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 z-10 relative">
      
      {/* 1. Header Hero Panel */}
      <header className="text-center mb-10 relative">
        <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full border border-glass-border bg-glass-card backdrop-blur-md mb-4 animate-float">
          <span className="relative flex h-3.5 w-3.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              isRecording ? 'bg-red-500' : isAiSpeaking ? 'bg-green-500' : ws.status === 'connected' ? 'bg-cyan-500' : 'bg-zinc-600'
            }`} />
            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
              isRecording ? 'bg-red-500' : isAiSpeaking ? 'bg-green-500' : ws.status === 'connected' ? 'bg-cyan-500' : 'bg-zinc-600'
            }`} />
          </span>
          <span className="text-sm font-semibold tracking-wider uppercase text-zinc-300">
            {isRecording ? 'Streaming Voice Live' : isAiSpeaking ? 'AI Speaking' : ws.status === 'connected' ? 'AI Core Connected' : 'AI Offline'}
          </span>
        </div>
        
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent glow-cyan mb-3">
          Sarvam AI Real-Time Gateway
        </h1>
        <p className="text-zinc-400 max-w-xl mx-auto text-sm md:text-base leading-relaxed">
          Integrated real-time bidirectional Speech-to-Text, LLM conversational stream (Saaras V3 / Bulbul v3), and scheduled audio playback.
        </p>
      </header>

      {/* Latency and Status Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="glass-panel p-4 rounded-xl text-center">
          <span className="text-[10px] text-zinc-500 uppercase font-mono block">STT Latency</span>
          <span className="text-lg font-bold text-cyan-400 font-mono mt-1 block">{sttLatency ? `${sttLatency}ms` : '--'}</span>
        </div>
        <div className="glass-panel p-4 rounded-xl text-center">
          <span className="text-[10px] text-zinc-500 uppercase font-mono block">LLM Response Lag (TTFT)</span>
          <span className="text-lg font-bold text-purple-400 font-mono mt-1 block">{llmFirstTokenLatency ? `${llmFirstTokenLatency}ms` : '--'}</span>
        </div>
        <div className="glass-panel p-4 rounded-xl text-center">
          <span className="text-[10px] text-zinc-500 uppercase font-mono block">V2V First Audio Lag</span>
          <span className="text-lg font-bold text-pink-400 font-mono mt-1 block">{totalTurnLatency ? `${totalTurnLatency}ms` : '--'}</span>
        </div>
        <div className="glass-panel p-4 rounded-xl text-center flex flex-col justify-center items-center">
          <span className="text-[10px] text-zinc-500 uppercase font-mono block">Playback Status</span>
          <span className={`text-xs font-bold uppercase mt-1.5 px-2.5 py-0.5 rounded-full border ${
            playbackStatus === 'speaking' ? 'bg-green-950/40 text-green-400 border-green-800' :
            playbackStatus === 'thinking' ? 'bg-yellow-950/40 text-yellow-500 border-yellow-800 animate-pulse' :
            playbackStatus === 'interrupted' ? 'bg-red-950/40 text-red-400 border-red-800' : 'bg-zinc-950/40 text-zinc-400 border-zinc-800'
          }`}>
            {playbackStatus}
          </span>
        </div>
      </div>

      {/* 2. Main Dashboard Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: System Controls & Waveform (7 Cols) */}
        <section className="lg:col-span-7 space-y-8">
          
          {/* Glassmorphism Control Core Card */}
          <div className="glass-panel rounded-2xl p-6 md:p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-6 border-b border-glass-border">
              <div>
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Assistant Control Center
                </h2>
                <p className="text-xs text-zinc-400 mt-1">Control your active connection and mic stream.</p>
              </div>
              
              <div className="flex gap-2">
                {interruptedBadge && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-950/30 border border-red-800/40 px-2 py-1 rounded-lg">
                    ⚠️ Interrupted
                  </span>
                )}
                {/* Main Glowing Indicator Orb */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-zinc-950/60 border border-glass-border">
                  <span className="text-xs font-mono text-zinc-400">WS:</span>
                  <span className={`text-xs font-bold uppercase ${
                    ws.status === 'connected' ? 'text-cyan-400 glow-cyan' :
                    ws.status === 'connecting' ? 'text-yellow-500' : 'text-zinc-500'
                  }`}>
                    {ws.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Audio Waveform visualizer container */}
            <div className="mb-6 space-y-2">
              <label className="text-xs font-bold text-zinc-400 tracking-wider uppercase block flex justify-between">
                <span>Vocal Waveform Visualizer</span>
                {isAiSpeaking && <span className="text-green-400 animate-pulse text-[10px] font-bold">AI Speaking Now...</span>}
              </label>
              <WaveformVisualizer analyserNode={analyserNode} isRecording={isRecording} />
            </div>

            {/* Language Selection and VAD settings panel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              
              {/* Language Selection Dropdown */}
              <div className="p-4 rounded-xl bg-zinc-950/40 border border-glass-border">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                  🎙️ Speak In Language
                </label>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  disabled={isRecording}
                  className="w-full bg-zinc-900 border border-glass-border text-zinc-200 text-xs rounded-lg p-2.5 outline-none focus:border-cyan-500 transition-colors disabled:opacity-40"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.value + lang.label} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <span className="text-[9px] text-zinc-500 mt-1.5 block">
                  BCP-47 Code: <span className="font-mono text-zinc-400">{selectedLanguage}</span>
                </span>
              </div>

              {/* VAD Settings Card */}
              <div className="p-4 rounded-xl bg-zinc-950/40 border border-glass-border flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                      ⚡ Voice Activity Detection
                    </label>
                    <input
                      type="checkbox"
                      checked={isVadEnabled}
                      onChange={(e) => setIsVadEnabled(e.target.checked)}
                      className="sr-only peer"
                      id="vad-toggle"
                    />
                    <label 
                      htmlFor="vad-toggle"
                      className="relative w-8 h-4 bg-zinc-700 rounded-full cursor-pointer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:translate-x-4"
                    />
                  </div>
                  <span className="text-[9px] text-zinc-500 block leading-tight">
                    Automatically stops the audio stream on silence to reduce API costs. (Silence timeout: 1.0s)
                  </span>
                </div>
                
                {/* Real-time volume bar and indicators */}
                {isRecording && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex justify-between text-[9px] font-mono text-zinc-400">
                      <span>VAD Level:</span>
                      <span className={isSilent ? 'text-zinc-500' : 'text-cyan-400 font-bold'}>
                        {isSilent ? 'Silence' : 'Speaking...'}
                      </span>
                    </div>
                    {/* RMS Level visual indicator */}
                    <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-glass-border">
                      <div 
                        className={`h-full transition-all duration-75 ${isSilent ? 'bg-zinc-700' : 'bg-gradient-to-r from-cyan-500 to-purple-500'}`}
                        style={{ width: `${Math.min(rmsVolume * 600, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Controls Button Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* WS Link Control Card */}
              <div className="p-4 rounded-xl bg-zinc-950/40 border border-glass-border flex flex-col justify-between">
                <span className="text-xs text-zinc-400 mb-3 block">1. WebSocket Link</span>
                <div className="flex gap-2">
                  {ws.status !== 'connected' ? (
                    <button
                      onClick={ws.connect}
                      disabled={ws.status === 'connecting'}
                      className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-cyan-800 disabled:to-blue-800 font-semibold text-sm transition-all shadow-glow-cyan flex items-center justify-center gap-2 text-white"
                    >
                      <svg className="w-4 h-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Connect WS
                    </button>
                  ) : (
                    <button
                      onClick={ws.disconnect}
                      className="w-full py-2.5 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-semibold text-sm transition-all border border-zinc-700 flex items-center justify-center gap-2 text-zinc-200"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Disconnect WS
                    </button>
                  )}
                </div>
              </div>

              {/* Mic Stream Control Card */}
              <div className="p-4 rounded-xl bg-zinc-950/40 border border-glass-border flex flex-col justify-between">
                <span className="text-xs text-zinc-400 mb-3 block">2. Speech-to-Text Pipeline</span>
                <div className="flex gap-2">
                  {isAiSpeaking || isAiThinking ? (
                    <button
                      onClick={triggerInterruption}
                      className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 font-semibold text-sm transition-all shadow-glow-purple flex items-center justify-center gap-2 text-white"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      Interrupt AI
                    </button>
                  ) : !isRecording ? (
                    <button
                      onClick={handleStartRecording}
                      disabled={ws.status !== 'connected'}
                      className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 disabled:pointer-events-none font-semibold text-sm transition-all shadow-glow-purple flex items-center justify-center gap-2 text-white"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      Start Streaming
                    </button>
                  ) : (
                    <button
                      onClick={handleStopRecording}
                      className="w-full py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-500 font-semibold text-sm transition-all border border-red-500 flex items-center justify-center gap-2 text-white"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                      Stop Streaming
                    </button>
                  )}
                </div>
              </div>

            </div>

            {/* Keyboard shortcut notice */}
            {(isAiSpeaking || isAiThinking) && (
              <span className="text-[10px] text-zinc-500 mt-3 block text-center font-mono">
                Pro-tip: Press <kbd className="bg-zinc-800 text-zinc-300 px-1 py-0.5 rounded border border-zinc-700">Spacebar</kbd> on your keyboard to instantly interrupt.
              </span>
            )}

            {/* Error alerts */}
            {recorderError && (
              <div className="mt-4 p-3 bg-red-950/40 border border-red-900/50 rounded-lg text-red-400 text-xs flex items-center gap-2">
                <span className="font-bold">Error:</span> {recorderError}
              </div>
            )}
          </div>

          {/* Session Metadata Information Card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            {/* Session ID display */}
            <div className="glass-panel rounded-xl p-4 sm:col-span-2 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                Persistent Session ID
              </span>
              <div className="flex items-center justify-between gap-2 mt-2 bg-zinc-950/60 p-2 rounded-lg border border-glass-border">
                <span className="text-xs font-mono text-cyan-400 truncate select-all">
                  {ws.sessionId || 'Not Connected'}
                </span>
                {ws.sessionId && (
                  <button
                    onClick={copySessionId}
                    className="p-1 text-zinc-400 hover:text-cyan-400 transition-colors"
                    title="Copy to clipboard"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Audio chunk counter & size */}
            <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                Metrics Streamed
              </span>
              <div className="space-y-1 mt-2">
                <div className="flex justify-between text-xs font-mono text-zinc-300">
                  <span>Chunks:</span>
                  <span className="text-purple-400 font-bold">{chunkCount}</span>
                </div>
                <div className="flex justify-between text-xs font-mono text-zinc-300">
                  <span>Data:</span>
                  <span className="text-pink-400 font-bold">{formatBytes(totalStreamedBytes)}</span>
                </div>
              </div>
            </div>

          </div>

        </section>

        {/* RIGHT COLUMN: Web Socket Logging Console & Live Transcripts (5 Cols) */}
        <section className="lg:col-span-5 space-y-8">
          
          {/* Week 3 & 4: Dialogue / AI Response Panel */}
          <div className="glass-panel rounded-2xl p-6 h-[270px] flex flex-col justify-between">
            <div className="flex justify-between items-center pb-3 border-b border-glass-border">
              <div>
                <h2 className="text-md font-bold text-zinc-100 flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  AI Streaming Response
                </h2>
                <p className="text-[10px] text-zinc-400 mt-0.5">Live streaming LLM tokens.</p>
              </div>
              <div className="flex items-center gap-1.5">
                {isAiThinking && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
                  </span>
                )}
                <span className="text-[10px] text-zinc-500 font-mono">
                  {isAiThinking ? 'Thinking...' : isAiSpeaking ? 'Speaking...' : 'Ready'}
                </span>
              </div>
            </div>

            {/* AI Streaming Response Text Area */}
            <div className="flex-1 overflow-y-auto my-3 pr-2 space-y-3 font-sans text-xs md:text-sm text-zinc-300">
              {aiResponseText ? (
                <div className="p-3.5 rounded-lg bg-purple-950/20 border border-purple-500/20 shadow-glow-purple">
                  <p className="leading-relaxed text-zinc-100 whitespace-pre-wrap">{aiResponseText}</p>
                  {isAiThinking && <span className="inline-block w-1.5 h-3 bg-purple-400 animate-pulse ml-1" />}
                  <div ref={responseEndRef} />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-[11px] gap-1.5 text-center">
                  <svg className="w-6 h-6 opacity-30 animate-pulse-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <span>After speaking finishes, the AI response text stream and tokens will display here.</span>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center text-[10px] text-zinc-500 border-t border-glass-border pt-2 font-mono">
              <span>Voice: <span className="text-zinc-400">Bulbul v3 (shubh)</span></span>
              <span>Model: <span className="text-zinc-400">sarvam-30b</span></span>
            </div>
          </div>

          {/* Week 2: Real-time Transcript Viewer Card */}
          <div className="glass-panel rounded-2xl p-6 h-[220px] flex flex-col justify-between">
            <div className="flex justify-between items-center pb-3 border-b border-glass-border">
              <div>
                <h2 className="text-md font-bold text-zinc-100 flex items-center gap-2">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Dialogue Transcriptions
                </h2>
                <p className="text-[10px] text-zinc-400 mt-0.5">Live Speech-to-Text outputs.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={clearTranscripts}
                  disabled={finalTranscripts.length === 0 && !partialTranscript}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:pointer-events-none transition-colors border border-glass-border px-2 py-1 rounded bg-zinc-950/40"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Transcripts dialogue area */}
            <div className="flex-1 overflow-y-auto my-3 pr-2 space-y-3 font-sans text-xs md:text-sm text-zinc-300">
              {finalTranscripts.length === 0 && !partialTranscript ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-[11px] gap-1.5 text-center">
                  <svg className="w-6 h-6 opacity-30 animate-pulse-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <span>Select language, start streaming, and speak.<br/>Transcripts will display here.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Cumulative Final Transcripts */}
                  {finalTranscripts.map((text, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-zinc-900/50 border border-glass-border">
                      <div className="text-[8px] font-mono text-zinc-500 mb-1 flex justify-between">
                        <span>SENTENCE #{idx + 1}</span>
                        {idx === finalTranscripts.length - 1 && sttLatency > 0 && (
                          <span className="text-cyan-500 font-bold">STT Latency: {sttLatency}ms</span>
                        )}
                      </div>
                      <p className="leading-relaxed text-zinc-200">{text}</p>
                    </div>
                  ))}
                  
                  {/* Real-time Partial (Draft) Transcript */}
                  {partialTranscript && (
                    <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-500/20 animate-pulse">
                      <div className="text-[8px] font-mono text-cyan-400 mb-1 tracking-wider font-bold">
                        SPEAKING LIVE...
                      </div>
                      <p className="italic text-cyan-300 leading-relaxed">{partialTranscript}...</p>
                    </div>
                  )}
                  <div ref={transcriptsEndRef} />
                </div>
              )}
            </div>

            {/* STT Status footer */}
            <div className="flex justify-between items-center text-[10px] text-zinc-500 border-t border-glass-border pt-2 font-mono">
              <span>STT Engine: <span className="text-zinc-400">Saaras V3</span></span>
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  sttStatus === 'connected' ? 'bg-green-500 animate-pulse' :
                  sttStatus === 'connecting' ? 'bg-yellow-500' : 'bg-zinc-700'
                }`} />
                <span className="capitalize">{sttStatus}</span>
              </span>
            </div>
          </div>

          {/* Web Socket Logging Console */}
          <div className="glass-panel rounded-2xl p-6 h-[250px] flex flex-col justify-between">
            <div className="flex justify-between items-center pb-3 border-b border-glass-border">
              <div>
                <h2 className="text-md font-bold text-zinc-100 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                  </span>
                  WebSocket Event Logs
                </h2>
                <p className="text-[10px] text-zinc-400 mt-0.5">Real-time WebSocket event frames.</p>
              </div>
              <button
                onClick={ws.clearLogs}
                disabled={ws.logs.length === 0}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:pointer-events-none transition-colors border border-glass-border px-2 py-1 rounded bg-zinc-950/40"
              >
                Clear Logs
              </button>
            </div>

            {/* Logs scrolling panel */}
            <div className="flex-1 overflow-y-auto my-3 pr-2 space-y-3 font-mono text-[10px]">
              {ws.logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-1">
                  <span>No events captured yet. Connect and start streaming.</span>
                </div>
              ) : (
                ws.logs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-2.5 rounded-lg border bg-zinc-950/70 ${
                      log.direction === 'out'
                        ? 'border-purple-900/35 hover:border-purple-700/50'
                        : 'border-cyan-900/35 hover:border-cyan-700/50'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1 pb-1 border-b border-zinc-900">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase ${
                          log.direction === 'out'
                            ? 'bg-purple-950 text-purple-300 border border-purple-800/40'
                            : 'bg-cyan-950 text-cyan-300 border border-cyan-800/40'
                        }`}>
                          {log.direction === 'out' ? '→ OUT' : '← IN'}
                        </span>
                        <span className="font-bold text-zinc-200">{log.type}</span>
                      </div>
                      <span className="text-zinc-500 font-normal">{log.timestamp}</span>
                    </div>
                    <pre className="overflow-x-auto text-[9px] text-zinc-400 whitespace-pre-wrap max-h-12 scrolling-thin">
                      {log.data}
                    </pre>
                  </div>
                ))
              )}
            </div>

            <div className="text-[9px] text-zinc-500 text-center border-t border-glass-border pt-2">
              Websocket URL: <span className="font-mono text-zinc-400">{WS_URL}</span>
            </div>
          </div>

        </section>

      </div>

      {/* 3. Future Architecture Roadmap Info Card */}
      <footer className="mt-12 glass-panel rounded-2xl p-6 md:p-8">
        <h3 className="text-lg font-bold text-zinc-100 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A1 1 0 0023 18.82V8.04a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 2" />
          </svg>
          System V2V Architecture Overview
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-zinc-400">
          <div className="p-4 rounded-xl bg-zinc-950/30 border border-glass-border">
            <span className="font-bold text-cyan-400 block mb-2 font-mono">1. Speech-to-Text (STT)</span>
            <p className="text-xs leading-relaxed">
              Saaras V3 streams PCM audio and returns real-time regional transcript segments back to the gateway.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-zinc-950/30 border border-glass-border">
            <span className="font-bold text-purple-400 block mb-2 font-mono">2. Conversational LLM</span>
            <p className="text-xs leading-relaxed">
              Once STT finalizes, Sarvam LLM streams AI response tokens, immediately updating the display panel and prompting TTS.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-zinc-950/30 border border-glass-border">
            <span className="font-bold text-pink-400 block mb-2 font-mono">3. Text-to-Speech (TTS)</span>
            <p className="text-xs leading-relaxed">
              Tokens are grouped into clause chunks and synthesized sequentially via Bulbul v3, feeding into the gapless AudioQueue.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default VoiceAssistant;
