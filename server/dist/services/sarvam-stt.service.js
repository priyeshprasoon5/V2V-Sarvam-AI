import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
function debugLog(msg) {
    try {
        fs.appendFileSync(path.resolve('debug.log'), `[${new Date().toISOString()}] [STT Service] ${msg}\n`);
    }
    catch (e) {
        console.error('Failed to write to debug.log:', e);
    }
}
/**
 * Service to interface with Sarvam Speech-to-Text Streaming APIs.
 * Connects directly to Sarvam wss:// endpoints, authenticating with Api-Subscription-Key,
 * and streams raw audio binary frames, routing transcription events to callbacks.
 *
 * When language is set to 'auto', the language_code parameter is omitted from the
 * connection URL so Sarvam auto-detects the spoken language. Any detected language_code
 * returned in the response is forwarded via callbacks so the rest of the pipeline can
 * adapt (LLM system prompt language instruction + TTS target language).
 */
export class SarvamSTTService {
    config;
    sarvamSocket = null;
    isConfigSent = false;
    audioQueue = [];
    // Callbacks for events
    // detectedLanguage is populated from the STT response when auto-detection is active
    onPartialCallback;
    onFinalCallback;
    onErrorCallback;
    onStatusCallback;
    constructor(config) {
        this.config = config;
        debugLog(`Initialized with endpoint: ${config.endpoint}`);
    }
    // --- Callback Registrations ---
    onPartial(callback) {
        this.onPartialCallback = callback;
    }
    onFinal(callback) {
        this.onFinalCallback = callback;
    }
    onError(callback) {
        this.onErrorCallback = callback;
    }
    onStatus(callback) {
        this.onStatusCallback = callback;
    }
    /**
     * Resolve HTTP/HTTPS API URL to WebSocket WSS URL.
     * When language is 'auto', language_code params are OMITTED so Sarvam auto-detects.
     */
    getWebSocketUrl(language, model) {
        // Replace http/https prefix with ws/wss
        let base = this.config.endpoint.replace(/^http/, 'ws');
        // Ensure URL ends with /ws
        if (!base.endsWith('/ws')) {
            base = base.replace(/\/$/, '') + '/ws';
        }
        // Build standard URL parameters as per Sarvam API Reference
        const params = new URLSearchParams({
            'model': model,
            'mode': 'transcribe',
            'sample_rate': '16000',
            'input_audio_codec': 'pcm_s16le',
            'high_vad_sensitivity': 'true',
            'vad_signals': 'true',
        });
        // Only append language params when a specific language is chosen.
        // 'auto' maps to Sarvam's official auto-detection value: 'unknown'.
        // Omitting language_code entirely causes a 403 Forbidden from the gateway.
        const resolvedLangCode = language === 'auto' ? 'unknown' : language;
        params.set('language_code', resolvedLangCode);
        params.set('language-code', resolvedLangCode); // Both forms for maximum compatibility
        return `${base}?${params.toString()}`;
    }
    /**
     * Connect to Sarvam AI STT Streaming Websocket.
     */
    async startStream(sessionId, language = 'en-IN', model = 'saaras:v3') {
        if (this.sarvamSocket && this.sarvamSocket.readyState === WebSocket.OPEN) {
            debugLog(`[Session: ${sessionId}] WebSocket is already open. Closing old stream first.`);
            await this.stopStream(sessionId);
        }
        this.isConfigSent = false;
        this.audioQueue = [];
        // Pass 'auto' through to getWebSocketUrl — it will handle the omission of language params.
        // Do NOT remap 'auto' to 'en-IN' here; doing so forces English transcription.
        const wsUrl = this.getWebSocketUrl(language, model);
        debugLog(`[Session: ${sessionId}] Connecting to Sarvam STT WebSocket at: ${wsUrl}`);
        debugLog(`[Session: ${sessionId}] API Key length: ${this.config.apiKey.length}`);
        if (this.onStatusCallback)
            this.onStatusCallback('connecting', 'Connecting to Sarvam STT...');
        try {
            // Connect to Sarvam AI using raw ws WebSocket client
            this.sarvamSocket = new WebSocket(wsUrl, {
                headers: {
                    // Authentication Header: Pass the Sarvam API Key
                    'api-subscription-key': this.config.apiKey,
                },
            });
            // 1. Connection Opened
            this.sarvamSocket.on('open', () => {
                debugLog(`[Session: ${sessionId}] Connected to Sarvam STT streaming server.`);
                if (this.sarvamSocket && this.sarvamSocket.readyState === WebSocket.OPEN) {
                    this.isConfigSent = true;
                    // Flush any queued audio chunks
                    if (this.audioQueue.length > 0) {
                        debugLog(`[Session: ${sessionId}] Flushing ${this.audioQueue.length} queued audio chunks.`);
                        for (const chunk of this.audioQueue) {
                            this.sendFormattedChunk(chunk);
                        }
                        this.audioQueue = [];
                    }
                }
                if (this.onStatusCallback)
                    this.onStatusCallback('connected', 'Connected to Sarvam STT.');
            });
            // 2. Message Received from Sarvam
            this.sarvamSocket.on('message', (data) => {
                try {
                    // Decode the incoming WebSocket frame.
                    // ws can deliver text frames as a string, or binary frames as a Buffer.
                    // We explicitly decode as UTF-8 to preserve multi-byte Indian-script characters.
                    const messageString = Buffer.isBuffer(data)
                        ? data.toString('utf8')
                        : (Array.isArray(data)
                            ? Buffer.concat(data).toString('utf8')
                            : String(data));
                    debugLog(`[Session: ${sessionId}] RAW RESPONSE: ${messageString}`);
                    const response = JSON.parse(messageString);
                    // Helper: extract detected language from any response level
                    // Sarvam returns language_code inside the data object after detection
                    const extractDetectedLang = (res) => res?.data?.language_code || res?.language_code || res?.detected_language_code || undefined;
                    // 1. Handle "type": "transcript" format
                    if (response.type === 'transcript' && typeof response.text === 'string') {
                        const transcript = response.text.trim();
                        const detectedLang = extractDetectedLang(response);
                        debugLog(`[Session: ${sessionId}] type: transcript -> "${transcript}" | lang: ${detectedLang || 'not returned'}`);
                        if (transcript) {
                            if (this.onFinalCallback)
                                this.onFinalCallback(transcript, detectedLang);
                        }
                        return;
                    }
                    // 2. Handle "type": "data" format — this is Sarvam's FINAL transcript event.
                    //    Important: Sarvam does NOT include an `is_final` field in this response.
                    //    The presence of "type":"data" with a non-empty transcript IS the final result.
                    if (response.type === 'data' && response.data) {
                        const dataObj = response.data;
                        const detectedLang = extractDetectedLang(response);
                        if (typeof dataObj.transcript === 'string') {
                            const transcript = dataObj.transcript.trim();
                            debugLog(`[Session: ${sessionId}] type: data (FINAL) -> transcript: "${transcript}" | lang: ${detectedLang || 'not returned'}`);
                            if (transcript) {
                                // Always fire onFinal — "type":"data" is always the final result from Sarvam
                                if (this.onFinalCallback)
                                    this.onFinalCallback(transcript, detectedLang);
                            }
                        }
                        return;
                    }
                    // 3. Fallback to direct root properties
                    if (typeof response.transcript === 'string') {
                        const transcript = response.transcript.trim();
                        const detectedLang = extractDetectedLang(response);
                        debugLog(`[Session: ${sessionId}] root transcript -> "${transcript}" | lang: ${detectedLang || 'not returned'}`);
                        if (transcript) {
                            if (response.is_final) {
                                if (this.onFinalCallback)
                                    this.onFinalCallback(transcript, detectedLang);
                            }
                            else {
                                if (this.onPartialCallback)
                                    this.onPartialCallback(transcript, detectedLang);
                            }
                        }
                        return;
                    }
                    if (typeof response.text === 'string') {
                        const transcript = response.text.trim();
                        const detectedLang = extractDetectedLang(response);
                        debugLog(`[Session: ${sessionId}] root text -> "${transcript}" | lang: ${detectedLang || 'not returned'}`);
                        if (transcript) {
                            if (this.onFinalCallback)
                                this.onFinalCallback(transcript, detectedLang);
                        }
                        return;
                    }
                    // Log warning for unrecognized structure
                    if (response.type !== 'speech_start' && response.type !== 'speech_end' && response.type !== 'error') {
                        debugLog(`[Session: ${sessionId}] Received unrecognized message structure: ${messageString}`);
                    }
                }
                catch (err) {
                    debugLog(`[Session: ${sessionId}] Failed to parse STT message: ${err.message}`);
                }
            });
            // 3. Connection Error
            this.sarvamSocket.on('error', (err) => {
                debugLog(`[Session: ${sessionId}] Sarvam STT connection error: ${err.message}`);
                if (this.onErrorCallback)
                    this.onErrorCallback(err);
            });
            // 4. Connection Closed
            this.sarvamSocket.on('close', (code, reason) => {
                const reasonStr = reason.toString('utf-8') || 'None';
                debugLog(`[Session: ${sessionId}] Sarvam STT WebSocket closed. Code: ${code}, Reason: ${reasonStr}`);
                if (this.onStatusCallback)
                    this.onStatusCallback('disconnected', `Closed: ${reasonStr} (${code})`);
            });
        }
        catch (err) {
            debugLog(`[Session: ${sessionId}] Failed to instantiate Sarvam WebSocket connection: ${err.message}`);
            if (this.onErrorCallback)
                this.onErrorCallback(err);
            if (this.onStatusCallback)
                this.onStatusCallback('disconnected', `Instantiation Failed: ${err.message}`);
        }
    }
    sendFormattedChunk(chunk) {
        if (this.sarvamSocket && this.sarvamSocket.readyState === WebSocket.OPEN) {
            const base64Chunk = chunk.toString('base64');
            const audioMessage = {
                audio: {
                    data: base64Chunk,
                    sample_rate: 16000,
                    encoding: 'audio/wav',
                }
            };
            this.sarvamSocket.send(JSON.stringify(audioMessage));
        }
    }
    /**
     * Stream a raw audio chunk to the Sarvam STT socket as a formatted JSON message frame.
     */
    sendAudioChunk(sessionId, audioBuffer) {
        if (!this.sarvamSocket) {
            debugLog(`[Session: ${sessionId}] Cannot send chunk: Sarvam WebSocket is not initialized.`);
            return;
        }
        if (!this.isConfigSent || this.sarvamSocket.readyState !== WebSocket.OPEN) {
            // If the WebSocket is connecting or open but the config frame has not been sent, queue the chunk
            if (this.sarvamSocket.readyState === WebSocket.CONNECTING || (this.sarvamSocket.readyState === WebSocket.OPEN && !this.isConfigSent)) {
                this.audioQueue.push(audioBuffer);
                return;
            }
            debugLog(`[Session: ${sessionId}] Cannot send chunk: Sarvam WebSocket is closed.`);
            return;
        }
        try {
            // Send formatted JSON frame
            this.sendFormattedChunk(audioBuffer);
        }
        catch (err) {
            debugLog(`[Session: ${sessionId}] Error sending formatted frame to Sarvam STT: ${err.message}`);
            if (this.onErrorCallback)
                this.onErrorCallback(err);
        }
    }
    /**
     * Gracefully close the connection to Sarvam.
     */
    async stopStream(sessionId) {
        this.isConfigSent = false;
        this.audioQueue = [];
        if (this.sarvamSocket) {
            debugLog(`[Session: ${sessionId}] Closing connection to Sarvam STT...`);
            if (this.sarvamSocket.readyState === WebSocket.OPEN || this.sarvamSocket.readyState === WebSocket.CONNECTING) {
                this.sarvamSocket.close(1000, 'Session stopped by client');
            }
            this.sarvamSocket = null;
        }
    }
}
export default SarvamSTTService;
