import { config } from '../config/env.js';
import { SarvamTTSService } from './sarvam-tts.service.js';
import { sessionRegistry } from '../session/registry.js';
import { latencyTracker } from './latency-tracker.service.js';
import { WebSocket } from 'ws';
export class AudioStreamService {
    ttsService;
    // Session states
    textBuffers = new Map();
    chunkIndices = new Map();
    ttsQueues = new Map();
    constructor() {
        this.ttsService = new SarvamTTSService({
            apiKey: config.SARVAM_API_KEY,
            endpoint: config.SARVAM_TTS_ENDPOINT,
        });
        this.setupListeners();
    }
    /**
     * Bind synthesized audio events and dispatch them to the user.
     */
    setupListeners() {
        this.ttsService.onAudioChunk((sessionId, payload, chunkIndex) => {
            latencyTracker.recordTTSEnd(sessionId, chunkIndex);
            const session = sessionRegistry.getSession(sessionId);
            if (!session)
                return;
            const socket = session.socket;
            if (socket.readyState !== WebSocket.OPEN)
                return;
            // 1. Emit tts:chunk to client
            this.sendEvent(socket, {
                type: 'tts:chunk',
                sessionId,
                timestamp: new Date().toISOString(),
                payload,
                chunkIndex,
            });
            // 2. Emit audio:chunk to client (equivalent for playback)
            this.sendEvent(socket, {
                type: 'audio:chunk',
                sessionId,
                timestamp: new Date().toISOString(),
                payload,
                chunkIndex,
            });
            // 3. Emit tts:end for this specific chunk
            this.sendEvent(socket, {
                type: 'tts:end',
                sessionId,
                timestamp: new Date().toISOString(),
                chunkIndex,
            });
        });
    }
    /**
     * Process streaming LLM tokens, accumulating text, and splitting on sentence boundaries.
     */
    processLLMToken(sessionId, token, isFinal, languageCode = 'en-IN') {
        let buffer = this.textBuffers.get(sessionId) || '';
        let chunkIndex = this.chunkIndices.get(sessionId) || 0;
        if (!isFinal) {
            buffer += token;
            this.textBuffers.set(sessionId, buffer);
            // Split sentences on . ? ! Hindi full stop (।), or newlines
            const boundaryRegex = /([.?!।\n]+)/;
            const match = buffer.match(boundaryRegex);
            if (match && match.index !== undefined) {
                const punctuationIndex = match.index + match[0].length;
                const textToSynthesize = buffer.slice(0, punctuationIndex).trim();
                const remaining = buffer.slice(punctuationIndex);
                this.textBuffers.set(sessionId, remaining);
                if (textToSynthesize) {
                    this.enqueueTTS(sessionId, textToSynthesize, languageCode, chunkIndex);
                    chunkIndex++;
                    this.chunkIndices.set(sessionId, chunkIndex);
                }
            }
        }
        else {
            // Stream final segment: synthesize any leftover buffer text
            const textToSynthesize = buffer.trim();
            this.textBuffers.delete(sessionId);
            this.chunkIndices.delete(sessionId);
            if (textToSynthesize) {
                this.enqueueTTS(sessionId, textToSynthesize, languageCode, chunkIndex);
                chunkIndex++;
            }
            // Enqueue final closure events
            this.enqueueFinalEvents(sessionId, chunkIndex);
        }
    }
    /**
     * Enqueue a text block for sequential synthesis to prevent overlap/out-of-order race conditions.
     */
    enqueueTTS(sessionId, text, languageCode, chunkIndex) {
        let queue = this.ttsQueues.get(sessionId);
        if (!queue) {
            queue = Promise.resolve();
        }
        const ttsTask = async () => {
            const session = sessionRegistry.getSession(sessionId);
            if (!session)
                return;
            const socket = session.socket;
            if (socket.readyState !== WebSocket.OPEN)
                return;
            latencyTracker.recordTTSStart(sessionId, chunkIndex);
            this.sendEvent(socket, {
                type: 'tts:start',
                sessionId,
                timestamp: new Date().toISOString(),
                chunkIndex,
            });
            try {
                await this.ttsService.synthesizeText(sessionId, text, languageCode, chunkIndex);
            }
            catch (err) {
                console.error(`[AudioStreamService] TTS Error for chunk #${chunkIndex}:`, err.message);
                this.sendEvent(socket, {
                    type: 'tts:error',
                    sessionId,
                    timestamp: new Date().toISOString(),
                    message: err.message,
                });
            }
        };
        queue = queue.then(ttsTask);
        this.ttsQueues.set(sessionId, queue);
    }
    /**
     * Enqueue termination events at the end of the promise chain.
     */
    enqueueFinalEvents(sessionId, totalChunks) {
        let queue = this.ttsQueues.get(sessionId);
        if (!queue)
            return;
        const endTask = async () => {
            const session = sessionRegistry.getSession(sessionId);
            if (!session)
                return;
            const socket = session.socket;
            if (socket.readyState !== WebSocket.OPEN)
                return;
            // Emit audio:end to signal completion
            this.sendEvent(socket, {
                type: 'audio:end',
                sessionId,
                timestamp: new Date().toISOString(),
            });
            // Close turn performance logs
            latencyTracker.endTurn(sessionId);
        };
        queue = queue.then(endTask);
        this.ttsQueues.delete(sessionId);
    }
    /**
     * Clear active queues and buffers, and abort ongoing TTS requests.
     */
    cancelActiveStream(sessionId) {
        this.textBuffers.delete(sessionId);
        this.chunkIndices.delete(sessionId);
        this.ttsQueues.delete(sessionId);
        this.ttsService.cancelSynthesis(sessionId);
    }
    sendEvent(socket, event) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(event));
        }
    }
}
export const audioStreamService = new AudioStreamService();
