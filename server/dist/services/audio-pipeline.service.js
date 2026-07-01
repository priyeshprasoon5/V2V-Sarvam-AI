import { config } from '../config/env.js';
import { SarvamSTTService } from './sarvam-stt.service.js';
import { SarvamLLMService } from './sarvam-llm.service.js';
import { SarvamTTSService } from './sarvam-tts.service.js';
import { conversationManager } from './conversation-manager.service.js';
/**
 * The AudioPipelineService coordinates the flow of events in the Real-Time V2V AI ecosystem.
 *
 * Flow:
 * User Voice (Client)
 *    │ (Websocket: audio:chunk)
 *    ▼
 * AudioPipelineService
 *    │
 *    ├─► 1. SarvamSTTService (transcribes audio)
 *    │      │ (Asynchronous callback: stt:final)
 *    │      ▼
 *    ├─► 2. ConversationManagerService (saves history prompt)
 *    │      ▼
 *    ├─► 3. SarvamLLMService (generates conversational reply tokens)
 *    │      │ (Asynchronous callback: llm:token -> stream to client)
 *    │      ▼
 *    └─► 4. SarvamTTSService (synthesizes speech from token streams)
 *           │ (Asynchronous callback: tts:chunk -> stream base64 audio to client)
 *           ▼
 *        Client Playback (Voice response)
 */
export class AudioPipelineService {
    sttService;
    llmService;
    ttsService;
    constructor() {
        // Instantiate all underlying AI services with environment configuration
        this.sttService = new SarvamSTTService({
            apiKey: config.SARVAM_API_KEY,
            endpoint: config.SARVAM_STT_ENDPOINT,
        });
        this.llmService = new SarvamLLMService({
            apiKey: config.SARVAM_API_KEY,
            endpoint: config.SARVAM_LLM_ENDPOINT,
        });
        this.ttsService = new SarvamTTSService({
            apiKey: config.SARVAM_API_KEY,
            endpoint: config.SARVAM_TTS_ENDPOINT,
        });
        this.setupPipelineListeners();
    }
    /**
     * Bind events across the various streaming components.
     * This is the "wiring" that links STT output to LLM inputs, and LLM output to TTS inputs.
     */
    setupPipelineListeners() {
        // 1. Hook STT results into the pipeline
        this.sttService.onFinal((transcript) => {
            console.log(`[AudioPipeline] STT Final Transcript received: "${transcript}"`);
            // Future Integration:
            // a. Save the user input text to conversation history: conversationManager.addMessage(sessionId, 'user', transcript)
            // b. Request LLM response: this.llmService.generateStreamingResponse(sessionId, history)
        });
        // 2. Hook LLM tokens into TTS and WebSocket client
        this.llmService.onToken((token, isFinal) => {
            console.log(`[AudioPipeline] LLM Token received: "${token}" (isFinal: ${isFinal})`);
            // Future Integration:
            // a. Forward token to UI via websocket: clientSocket.send(JSON.stringify({ type: 'llm:token', token }))
            // b. Accumulate sentence chunks to stream to TTS service: this.ttsService.synthesizeText(sessionId, sentence)
        });
        // 3. Hook TTS audio generation back to WebSocket
        this.ttsService.onAudioChunk((audioBase64, chunkIndex) => {
            console.log(`[AudioPipeline] TTS Chunk #${chunkIndex} synthesized.`);
            // Future Integration:
            // Send the synthesized audio chunk back to the client for playback:
            // clientSocket.send(JSON.stringify({ type: 'tts:chunk', payload: audioBase64, chunkIndex }))
        });
    }
    /**
     * Initialize a new pipeline context for an active WebSocket session.
     */
    async startPipeline(sessionId) {
        console.log(`[AudioPipeline] [Session: ${sessionId}] Initializing pipeline services...`);
        await this.sttService.startStream(sessionId);
        conversationManager.initializeSession(sessionId);
    }
    /**
     * Process a live voice chunk sent by the client.
     */
    processAudioChunk(sessionId, chunkBuffer) {
        // Feed the chunk directly into the Speech-to-Text streaming engine
        this.sttService.sendAudioChunk(sessionId, chunkBuffer);
    }
    /**
     * Handle user interruption (e.g. client started speaking while assistant was talking).
     * This needs to immediately halt LLM and TTS tasks.
     */
    handleInterruption(sessionId) {
        console.log(`[AudioPipeline] [Session: ${sessionId}] Handling interruption request...`);
        this.llmService.cancelGeneration(sessionId);
        this.ttsService.cancelSynthesis(sessionId);
        // Future Integration: Send notification to client to stop active audio element playback
    }
    /**
     * Stop the active pipeline.
     */
    async stopPipeline(sessionId) {
        console.log(`[AudioPipeline] [Session: ${sessionId}] Stopping pipeline services.`);
        await this.sttService.stopStream(sessionId);
        conversationManager.clearHistory(sessionId);
    }
}
export const audioPipeline = new AudioPipelineService();
