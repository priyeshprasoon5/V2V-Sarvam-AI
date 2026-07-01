# Real-Time Voice-to-Voice AI Ecosystem

This project builds a low-latency, modular gateway infrastructure for a real-time Voice-to-Voice (V2V) Conversational AI system.

---

## 1. Overall System Architecture

The ecosystem split responsibility between a high-performance React interface (Next.js) and a streaming WebSocket event gateway (Fastify).

```mermaid
graph TD
    subgraph Client (Next.js)
        User[User Microphone] -->|Web Audio API / MediaRecorder| Capture[Audio Chunk Slicer]
        Capture -->|useVoiceActivityDetection| VAD[Silence Auto-Stop Controller]
        Capture -->|Base64 JSON Chunks| WSClient[WebSocket client]
        WSClient -->|stt:start / stt:audio / stt:stop| WSServer
        WSServer -->|stt:partial / stt:final / stt:status / stt:error| WSClient
        WSClient -->|Canvas API| Waveform[Waveform Visualizer]
    end

    subgraph Server (Fastify Gateway)
        WSServer[WebSocket Manager] -->|Session Validation| SessionReg[Session Registry]
        WSServer -->|Pipes raw buffers| handler[WebSocket Handler]
        handler -->|Authentication Handshake| STT[Sarvam STT Service]
        STT -->|Proxy Socket| SarvamAPI[Sarvam AI Streaming STT]
        handler -->|Compute latencies| TM[Transcript Manager]
    end
```

---

## 2. Week 2: Speech-to-Text (STT) Layer

The Speech-To-Text layer acts as **"The Ears"** of the voice-to-voice assistant, transcribing spoken audio into text in real time using the **Sarvam AI Saaras v3** WebSocket model.

### 2.1 Voice Activity Detection (VAD)
To reduce API overhead and avoid extra compute costs, the client implements an RMS-based Voice Activity Detection (VAD) hook:
- Measures microphone signal Root Mean Square (RMS) amplitude via the Web Audio API.
- If RMS stays below the threshold (`0.015`) for a continuous silence duration of **1.0 second**, VAD triggers silence detection and automatically calls `stopStreaming`, closing both the microphone tracks and the STT WebSocket.

### 2.2 Regional Language Dropdown Selector
We support 14 major regional Indian languages along with Hindi, English, and Hinglish. The language code is passed to the backend inside the `stt:start` event and injected as a BCP-47 query parameter during the server-to-Sarvam WebSocket handshake:
- **Auto Select** (`auto`)
- **English (India)** (`en-IN`)
- **Hindi / Hinglish** (`hi-IN`)
- **Bengali** (`bn-IN`), **Marathi** (`mr-IN`), **Telugu** (`te-IN`), **Tamil** (`ta-IN`), **Gujarati** (`gu-IN`), **Kannada** (`kn-IN`), **Malayalam** (`ml-IN`), **Punjabi** (`pa-IN`), **Odia** (`or-IN`), **Urdu** (`ur-IN`), **Assamese** (`as-IN`).

---

## 3. Real-Time STT WebSocket Lifecycle

```text
 Client (Next.js)                                      Server (Fastify)                       Sarvam AI STT API
        │                                                     │                                       │
        ├────────────── connection:init (Session ID) ────────►│                                       │
        │◄───────────── server:ack (Success) ─────────────────┤                                       │
        │                                                     │                                       │
        │────────────── stt:start (Language + Model) ────────►│                                       │
        │                                                     ├─ wss://api.sarvam.ai/speech-to-text ─►│
        │                                                     │  (Api-Subscription-Key Header)        │
        │◄───────────── stt:status (Connecting/Connected) ────┼◄──────────────────────────────────────┤
        │                                                     │                                       │
        │────────────── stt:audio (Base64 Chunk) ────────────►│                                       │
        │                                                     ├─────── Binary Frame (PCM Buffer) ────►│
        │◄───────────── server:ack (Chunk processed) ─────────┤                                       │
        │                                                     │                                       │
        │                                                     │◄────── Raw Message (Text Frame) ──────┤
        │                                                     │        { transcript, is_final }       │
        │◄───────────── stt:partial (Live draft text) ────────┼◄──────────────────────────────────────┤
        │                                                     │                                       │
        │                                                     │◄────── Raw Message (Text Final) ──────┤
        │                                                     │                                       │
        │                                                     ├─► [Logs Transcript latency]           │
        │◄───────────── stt:final (Sentence segment) ─────────┼◄──────────────────────────────────────┤
        │                                                     │                                       │
        │────────────── stt:stop (Speech End / VAD Silence) ─►│                                       │
        │                                                     ├────────── Close Socket (1000) ───────►│
```

---

## 4. Session & Performance Tracking

- **Transcript Manager**: The backend `TranscriptManager` tracks finalized segments, logging the text, session ID, unique stream ID, and speech duration.
- **Latency Tracking**: Measures the processing lag (time from the arrival of the last audio chunk to the server receiving the final transcription result from Sarvam) and exposes the metric to the client.

---

## 5. Local Setup and Development

### Credentials Configuration
1. Open `server/.env` in the server root folder.
2. Write your secret Sarvam AI Subscription Key under `SARVAM_API_KEY`:
   ```env
   SARVAM_API_KEY=your_actual_sarvam_subscription_key
   ```

### Backend Startup (`server/`)
1. Navigate to the server directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development gateway:
   ```bash
   npm run dev
   ```
   *Gateway boots on `http://127.0.0.1:5000` (WebSocket URI: `ws://127.0.0.1:5000/ws`)*

### Frontend Startup (`client/`)
1. Navigate to the client directory:
   ```bash
   cd client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development client:
   ```bash
   npm run dev
   ```
   *Open [http://localhost:3000](http://localhost:3000) in your browser.*

### Verification builds
Verify compiler types by running:
- **Server**: `cd server && npm run build`
- **Client**: `cd client && npm run build`

---

## 6. Week 3 & 4: Voice-to-Voice (V2V) Integration

We have built a fully automated real-time Conversational Voice AI. The system pipeline handles:
`User Voice → STT Transcripts → LLM Context → Token Streaming → Chunk-based TTS Synthesis → Scheduled Gapless Playback`.

### 6.1 Conversational Memory & System Prompting
- **System Prompting:** Prompts are stored in `server/src/config/prompts.ts` with instructions to keep replies conversational, concise, natural, and easy to speak aloud.
- **Short-Term Dialogue Context:** User and assistant turns are stored in `server/src/services/conversation-manager.service.ts`. The design wraps in-memory map calls so it can be seamlessly migrated to Redis in future weeks.

### 6.2 Chunk-Based TTS Pipeline
To minimize response latency, the backend does not wait for full LLM completion. LLM token outputs are buffered, split at sentence boundaries (`.`, `?`, `!`, `।`, `\n`), and immediately enqueued to the `AudioStreamService`.
- **Sequential Queueing:** A Promise-based task queue per session ensures TTS requests are sent to Sarvam AI and streamed back to the browser in the exact correct order.

### 6.3 Gapless Audio Queue Playback
The client receives PCM audio chunks and plays them back gaplessly using `client/services/audioQueue.ts`.
- Uses Web Audio API scheduled start times (`AudioContext.currentTime`) to eliminate pops, clicks, or overlapping audio.

### 6.4 Double-Triggered Interruption Handling
If a user interrupts while the AI is speaking, the system instantly halts the assistant:
- **Voice Trigger:** Client-side VAD detects speech activity (`isSilent = false` while AI is speaking).
- **Keyboard/Mouse Trigger:** Clicking "Interrupt AI" or pressing the `Spacebar` key.
- **Protocol action:** Client cancels local audio playback, clears queues, and emits `interruption:start`. The backend aborts ongoing fetch operations (LLM SSE stream and TTS) using `AbortController` and signals `interruption:complete` back to the client.

### 6.5 End-to-End WebSocket V2V Lifecycle

```text
 Client (Next.js)                                      Server (Fastify)                       Sarvam AI APIs
        │                                                     │                                       │
        ├────────────── connection:init ─────────────────────►│                                       │
        │                                                     │                                       │
        ├────────────── stt:start (Lang selection) ──────────►│                                       │
        │                                                     ├────── Establish STT socket ──────────►│
        │                                                     │                                       │
        │────────────── stt:audio (Base64 Mic PCM) ──────────►│────── Forward Audio Frame ───────────►│
        │                                                     │                                       │
        │◄───────────── stt:partial (Live draft text) ────────┼◄───── Partial Transcript Result ──────┤
        │                                                     │                                       │
        │◄───────────── stt:final (sentence segment) ─────────┼◄───── Final Transcript Result ────────┤
        │                                                     │                                       │
        │                                                     ├─────► [Store user message in memory]  │
        │◄───────────── llm:start (Indicator on) ─────────────┤                                       │
        │◄───────────── audio:start (Player active) ──────────┤                                       │
        │                                                     │                                       │
        │                                                     ├─────► POST /v1/chat/completions ─────►│
        │◄───────────── llm:token (Streamed text) ────────────┼◄───── Streamed SSE Chunk (delta) ─────┤
        │                                                     │                                       │
        │                                                     ├─────► [Accumulate sentence boundaries]│
        │◄───────────── tts:start (Chunk #0 processing) ──────┤                                       │
        │                                                     ├─────► POST /text-to-speech (Bulbul) ─►│
        │                                                     │◄───── { audios: [ base64_wav ] } ─────┤
        │◄───────────── tts:chunk / audio:chunk ──────────────┤                                       │
        │◄───────────── tts:end (Chunk #0 done) ──────────────┤                                       │
        │                                                     │                                       │
        │◄───────────── llm:complete (LLM ends) ──────────────┤                                       │
        │◄───────────── audio:end (No more audio) ────────────┤                                       │
```

