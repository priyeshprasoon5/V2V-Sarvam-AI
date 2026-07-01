import { WebSocket } from 'ws';
import { sessionRegistry } from '../session/registry.js';
import { audioPipeline } from '../services/audio-pipeline.service.js';
import { SarvamSTTService } from '../services/sarvam-stt.service.js';
import { transcriptManager } from '../services/transcript-manager.service.js';
import { config } from '../config/env.js';
import { SarvamLLMService } from '../services/sarvam-llm.service.js';
import { conversationManager } from '../services/conversation-manager.service.js';
import { promptManager } from '../services/prompt-manager.service.js';
import { audioStreamService } from '../services/audio-stream.service.js';
import { latencyTracker } from '../services/latency-tracker.service.js';
import fs from 'fs';
import path from 'path';
function debugLog(msg) {
    try {
        fs.appendFileSync(path.resolve('debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
    }
    catch (e) {
        console.error('Failed to write to debug.log:', e);
    }
}
/**
 * Handle incoming events from connected clients.
 * Translates JSON actions into session state changes, STT service calls, or AI pipeline triggers.
 */
export async function handleClientMessage(socket, event) {
    const { type, sessionId } = event;
    if (type !== 'stt:audio' && type !== 'audio:chunk') {
        debugLog(`[WS Message] Session: ${sessionId} | Event: ${type}`);
    }
    switch (type) {
        case 'connection:init': {
            console.log(`[WS Handler] [Session: ${sessionId}] connection:init received`);
            // Register this session in our registry
            sessionRegistry.registerSession(sessionId, socket);
            // Respond with acknowledgment
            sendResponse(socket, {
                type: 'server:ack',
                sessionId,
                timestamp: new Date().toISOString(),
                status: 'success',
                message: 'Connection initialized successfully.',
            });
            break;
        }
        // === WEEK 2: NEW STT EVENT PROTOCOLS ===
        case 'stt:start': {
            const startEvent = event;
            const language = startEvent.language || 'en-IN';
            const model = startEvent.model || 'saaras:v3';
            console.log(`[WS Handler] [Session: ${sessionId}] stt:start received | Language: ${language} | Model: ${model}`);
            const session = sessionRegistry.getSession(sessionId);
            if (!session) {
                throw new Error('Session not initialized. Please call connection:init first.');
            }
            // 1. Initialize metadata and generate a unique Stream ID for this recording turn
            session.metadata = session.metadata || {};
            const streamId = `str_${Math.random().toString(36).substring(2, 9)}`;
            session.metadata.streamId = streamId;
            session.metadata.streamStartTime = Date.now();
            session.metadata.lastChunkTime = Date.now();
            session.metadata.language = language;
            sessionRegistry.setStreamingState(sessionId, true);
            // 2. Initialize or reuse the Sarvam STT service instance
            let sttService = session.metadata.sttService;
            if (!sttService) {
                sttService = new SarvamSTTService({
                    apiKey: config.SARVAM_API_KEY,
                    endpoint: config.SARVAM_STT_ENDPOINT,
                });
                session.metadata.sttService = sttService;
            }
            // 3. Register service listeners mapping Sarvam events back to the client
            // Real-time partial transcript handler
            sttService.onPartial((transcript, detectedLanguage) => {
                // If auto mode and Sarvam returned a detected language, update the session metadata
                if (session.metadata?.language === 'auto' && detectedLanguage) {
                    session.metadata.language = detectedLanguage;
                    debugLog(`[onPartial] Auto-detected language from STT: ${detectedLanguage}`);
                }
                sendResponse(socket, {
                    type: 'stt:partial',
                    sessionId,
                    timestamp: new Date().toISOString(),
                    transcript,
                });
            });
            // Finalized transcript segment handler
            sttService.onFinal(async (transcript, detectedLanguage) => {
                debugLog(`[onFinal] Session: ${sessionId} | Transcript: "${transcript}" | detectedLang: ${detectedLanguage || 'none'}`);
                const now = Date.now();
                // Calculate performance metrics
                const lastChunkTime = session.metadata?.lastChunkTime || now;
                const latencyMs = now - lastChunkTime;
                const speechDurationMs = now - (session.metadata?.streamStartTime || now);
                // Record metrics and text inside the session transcript manager
                transcriptManager.addTranscript(sessionId, streamId, transcript, speechDurationMs, latencyMs);
                // Emit final segment event back to frontend UI
                sendResponse(socket, {
                    type: 'stt:final',
                    sessionId,
                    timestamp: new Date().toISOString(),
                    transcript,
                    latencyMs,
                });
                // Trigger Voice-to-Voice LLM + TTS Pipeline
                try {
                    latencyTracker.startTurn(sessionId, latencyMs);
                    // Map language BCP-47 codes to human readable names for LLM instructions
                    const LANGUAGE_NAMES = {
                        'en-IN': 'English',
                        'hi-IN': 'Hindi (including code-mixed Hinglish)',
                        'bn-IN': 'Bengali',
                        'mr-IN': 'Marathi',
                        'te-IN': 'Telugu',
                        'ta-IN': 'Tamil',
                        'gu-IN': 'Gujarati',
                        'kn-IN': 'Kannada',
                        'ml-IN': 'Malayalam',
                        'pa-IN': 'Punjabi',
                        'or-IN': 'Odia',
                        'ur-IN': 'Urdu',
                        'as-IN': 'Assamese',
                        'mai-IN': 'Maithili',
                    };
                    // --- Language Resolution ---
                    // Read the session language (already set in session.metadata.language).
                    // In 'auto' mode:
                    //   1. If Sarvam returned a detected language code, use it.
                    //   2. Otherwise, keep 'auto' and tell the LLM to mirror the user's language.
                    let currentLanguage = session.metadata?.language || 'en-IN';
                    if (currentLanguage === 'auto' && detectedLanguage) {
                        // Sarvam successfully detected the language – lock it into the session
                        // so TTS also uses the right language.
                        currentLanguage = detectedLanguage;
                        session.metadata.language = detectedLanguage;
                        debugLog(`[onFinal] Auto-detected language from STT: ${detectedLanguage}`);
                    }
                    const baseSystemPrompt = promptManager.getSystemPrompt();
                    let dynamicSystemPrompt;
                    if (currentLanguage === 'auto') {
                        // No language detected yet – instruct LLM to mirror whatever the user spoke
                        dynamicSystemPrompt = baseSystemPrompt +
                            `\n\nCRITICAL: The user is using auto language mode. Detect the language from the user's latest message and ALWAYS respond in THAT SAME language and script (e.g., Bengali script for Bengali, Devanagari for Hindi/Maithili, Tamil script for Tamil, etc.). Never switch to English unless the user speaks English.`;
                    }
                    else {
                        const languageName = LANGUAGE_NAMES[currentLanguage] || currentLanguage;
                        dynamicSystemPrompt = baseSystemPrompt +
                            `\n\nCRITICAL: The user is speaking in ${languageName}. You MUST respond strictly in ${languageName} using its native script. Keep the response spoken, concise, and natural.`;
                    }
                    // --- Conversation History Management ---
                    // Track the language used on the PREVIOUS turn.
                    // When language changes, we MUST reset conversation history because old-language
                    // messages in the history cause the LLM to continue replying in the old language
                    // even when the system prompt has been updated.
                    const lastUsedLanguage = session.metadata?.lastUsedLanguage;
                    const languageSwitched = lastUsedLanguage !== undefined && lastUsedLanguage !== currentLanguage;
                    if (languageSwitched) {
                        debugLog(`[onFinal] Language switched: ${lastUsedLanguage} → ${currentLanguage}. Resetting conversation history.`);
                        console.log(`[WS Handler] [Session: ${sessionId}] Language switch detected (${lastUsedLanguage} → ${currentLanguage}). Resetting conversation history.`);
                        // Start fresh conversation with new language system prompt
                        conversationManager.initializeSession(sessionId, dynamicSystemPrompt);
                    }
                    else {
                        // Same language — update or initialize conversation history
                        let history = conversationManager.getHistory(sessionId);
                        if (history.length === 0 || history[0].role !== 'system') {
                            conversationManager.initializeSession(sessionId, dynamicSystemPrompt);
                        }
                        else {
                            // Update the system prompt with the latest language instruction on every turn
                            history[0].content = dynamicSystemPrompt;
                        }
                    }
                    // Record the language used for this turn so we can detect switches next time
                    session.metadata.lastUsedLanguage = currentLanguage;
                    conversationManager.addMessage(sessionId, 'user', transcript);
                    let history = conversationManager.getHistory(sessionId);
                    // Emit LLM Start and Audio Start
                    sendResponse(socket, {
                        type: 'llm:start',
                        sessionId,
                        timestamp: new Date().toISOString(),
                    });
                    sendResponse(socket, {
                        type: 'audio:start',
                        sessionId,
                        timestamp: new Date().toISOString(),
                    });
                    latencyTracker.recordLLMStart(sessionId);
                    let llmService = session.metadata.llmService;
                    if (!llmService) {
                        llmService = new SarvamLLMService({
                            apiKey: config.SARVAM_API_KEY,
                            endpoint: config.SARVAM_LLM_ENDPOINT,
                        });
                        session.metadata.llmService = llmService;
                    }
                    let fullResponse = '';
                    llmService.onToken((sessId, token, isFinal) => {
                        if (socket.readyState !== WebSocket.OPEN)
                            return;
                        if (!isFinal) {
                            latencyTracker.recordLLMFirstToken(sessId);
                            fullResponse += token;
                            sendResponse(socket, {
                                type: 'llm:token',
                                sessionId,
                                timestamp: new Date().toISOString(),
                                token,
                                isFinal: false,
                            });
                            // Always read the LIVE language from session metadata so mid-session
                            // language switches are immediately reflected in TTS output
                            const activeLanguage = session.metadata?.language || 'en-IN';
                            audioStreamService.processLLMToken(sessId, token, false, activeLanguage);
                        }
                        else {
                            latencyTracker.recordLLMEnd(sessId);
                            sendResponse(socket, {
                                type: 'llm:complete',
                                sessionId,
                                timestamp: new Date().toISOString(),
                            });
                            if (fullResponse.trim()) {
                                conversationManager.addMessage(sessId, 'assistant', fullResponse.trim());
                            }
                            const activeLanguageFinal = session.metadata?.language || 'en-IN';
                            audioStreamService.processLLMToken(sessId, '', true, activeLanguageFinal);
                        }
                    });
                    debugLog(`[onFinal] Executing streaming response...`);
                    await llmService.generateStreamingResponse(sessionId, history);
                    debugLog(`[onFinal] generateStreamingResponse returned.`);
                }
                catch (err) {
                    debugLog(`[onFinal] ERROR: ${err.stack || err.message}`);
                    console.error(`[WS Handler] [Session: ${sessionId}] Error in V2V response loop:`, err.message);
                    sendResponse(socket, {
                        type: 'llm:error',
                        sessionId,
                        timestamp: new Date().toISOString(),
                        message: err.message,
                    });
                }
            });
            // Status change handler
            sttService.onStatus((status, message) => {
                sendResponse(socket, {
                    type: 'stt:status',
                    sessionId,
                    timestamp: new Date().toISOString(),
                    status,
                    message,
                });
            });
            // Error event handler
            sttService.onError((err) => {
                sendResponse(socket, {
                    type: 'stt:error',
                    sessionId,
                    timestamp: new Date().toISOString(),
                    message: err.message,
                });
            });
            // 4. Start the streaming socket link to Sarvam AI
            await sttService.startStream(sessionId, language, model);
            break;
        }
        case 'stt:audio': {
            const audioEvent = event;
            const base64Payload = audioEvent.payload;
            const chunkIndex = audioEvent.chunkIndex;
            const session = sessionRegistry.getSession(sessionId);
            if (!session) {
                throw new Error('Session not found for streaming STT audio chunks.');
            }
            // Record transit timestamp to compute transcription latency later
            if (session.metadata) {
                session.metadata.lastChunkTime = Date.now();
            }
            // Decode base64 frame back to raw binary PCM buffer
            const audioBuffer = Buffer.from(base64Payload, 'base64');
            // Update session metrics
            sessionRegistry.incrementChunkMetrics(sessionId, audioBuffer.length);
            // Extract STT service instance
            const sttService = session.metadata?.sttService;
            if (sttService) {
                // Forward binary payload directly to Sarvam AI STT websocket
                sttService.sendAudioChunk(sessionId, audioBuffer);
            }
            // Acknowledge receipt of this chunk
            sendResponse(socket, {
                type: 'server:ack',
                sessionId,
                timestamp: new Date().toISOString(),
                chunkIndex,
                status: 'success',
                message: `STT Chunk #${chunkIndex} processed.`,
            });
            break;
        }
        case 'stt:stop': {
            console.log(`[WS Handler] [Session: ${sessionId}] stt:stop received`);
            const session = sessionRegistry.getSession(sessionId);
            if (session) {
                sessionRegistry.setStreamingState(sessionId, false);
                const sttService = session.metadata?.sttService;
                if (sttService) {
                    // Gracefully close Sarvam STT stream
                    await sttService.stopStream(sessionId);
                }
            }
            break;
        }
        // === WEEK 1: GENERAL / LEGACY ROUTING CHANNELS (KEPT INTACT) ===
        case 'stream:start': {
            console.log(`[WS Handler] [Session: ${sessionId}] stream:start received`);
            const session = sessionRegistry.getSession(sessionId);
            if (!session) {
                throw new Error('Session not initialized. Please call connection:init first.');
            }
            sessionRegistry.setStreamingState(sessionId, true);
            await audioPipeline.startPipeline(sessionId);
            sendResponse(socket, {
                type: 'server:ack',
                sessionId,
                timestamp: new Date().toISOString(),
                status: 'success',
                message: 'Voice streaming stream:start acknowledged.',
            });
            break;
        }
        case 'audio:chunk': {
            const chunkEvent = event;
            const base64Payload = chunkEvent.payload;
            const chunkIndex = chunkEvent.chunkIndex;
            const session = sessionRegistry.getSession(sessionId);
            if (!session) {
                throw new Error('Session not found for streaming audio chunks.');
            }
            const chunkBuffer = Buffer.from(base64Payload, 'base64');
            sessionRegistry.incrementChunkMetrics(sessionId, chunkBuffer.length);
            console.log(`[WS Handler] [Session: ${sessionId}] Received Audio Chunk #${chunkIndex} | Size: ${chunkBuffer.length} bytes`);
            audioPipeline.processAudioChunk(sessionId, chunkBuffer);
            sendResponse(socket, {
                type: 'server:ack',
                sessionId,
                timestamp: new Date().toISOString(),
                status: 'success',
                chunkIndex,
                message: `Chunk #${chunkIndex} processed.`,
            });
            break;
        }
        case 'stream:stop': {
            console.log(`[WS Handler] [Session: ${sessionId}] stream:stop received`);
            const session = sessionRegistry.getSession(sessionId);
            if (session) {
                sessionRegistry.setStreamingState(sessionId, false);
            }
            await audioPipeline.stopPipeline(sessionId);
            sendResponse(socket, {
                type: 'server:ack',
                sessionId,
                timestamp: new Date().toISOString(),
                status: 'success',
                message: 'Voice streaming stream:stop acknowledged.',
            });
            break;
        }
        case 'interruption:start': {
            console.log(`[WS Handler] [Session: ${sessionId}] interruption:start received`);
            // Stop legacy pipeline if active
            audioPipeline.handleInterruption(sessionId);
            // Cancel modern V2V pipeline
            const session = sessionRegistry.getSession(sessionId);
            if (session) {
                if (session.metadata?.llmService) {
                    session.metadata.llmService.cancelGeneration(sessionId);
                }
                audioStreamService.cancelActiveStream(sessionId);
            }
            // Send interruption:complete back to client
            sendResponse(socket, {
                type: 'interruption:complete',
                sessionId,
                timestamp: new Date().toISOString(),
            });
            break;
        }
        default: {
            console.warn(`[WS Handler] Unhandled event type received: ${type}`);
            break;
        }
    }
}
/**
 * Send an event response back to the client socket.
 */
function sendResponse(socket, response) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(response));
    }
}
