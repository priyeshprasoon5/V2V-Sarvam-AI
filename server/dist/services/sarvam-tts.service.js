/**
 * Service to interface with Sarvam Text-to-Speech APIs.
 * Synthesizes text outputs into audio streams by requesting PCM/MP3 base64 chunks.
 */
export class SarvamTTSService {
    config;
    onAudioChunkCallback;
    activeControllers = new Map();
    constructor(config) {
        this.config = config;
        console.log('[SarvamTTSService] Initialized service with endpoint:', config.endpoint);
    }
    /**
     * Register a listener for synthesized audio chunks.
     * Sends base64-encoded PCM/MP3 chunks back to the client.
     */
    onAudioChunk(callback) {
        this.onAudioChunkCallback = callback;
    }
    /**
     * Request TTS synthesis for a given string.
     */
    async synthesizeText(sessionId, text, languageCode = 'en-IN', chunkIndex = 0) {
        console.log(`[SarvamTTSService] [Session: ${sessionId}] Synthesizing text chunk #${chunkIndex}: "${text}"`);
        const controller = new AbortController();
        const controllerKey = `${sessionId}_${chunkIndex}`;
        this.activeControllers.set(controllerKey, controller);
        try {
            // Map 'auto' selector to English (India)
            let targetLang = languageCode === 'auto' ? 'en-IN' : languageCode;
            // Map unsupported languages to closest supported ones for TTS (e.g., Maithili and Urdu -> Hindi)
            const ttsLanguageMapping = {
                'mai-IN': 'hi-IN',
                'ur-IN': 'hi-IN'
            };
            if (ttsLanguageMapping[targetLang]) {
                console.log(`[SarvamTTSService] Mapping unsupported TTS language ${targetLang} -> ${ttsLanguageMapping[targetLang]}`);
                targetLang = ttsLanguageMapping[targetLang];
            }
            // Select speaker from environment variable or default to shubh
            const speaker = process.env.SARVAM_TTS_SPEAKER || 'shubh';
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'api-subscription-key': this.config.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    target_language_code: targetLang,
                    speaker: speaker,
                    model: 'bulbul:v3',
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sarvam TTS API returned status ${response.status}: ${errorText}`);
            }
            const data = (await response.json());
            if (!data.audios || !Array.isArray(data.audios) || data.audios.length === 0) {
                throw new Error('Sarvam TTS API response did not contain audios list or array was empty');
            }
            const base64Audio = data.audios[0];
            console.log('[SarvamTTSService] base64 audio payload length:', base64Audio.length);
            // Log first 30 chars for preview
            console.log('[SarvamTTSService] base64 preview:', base64Audio.slice(0, 30), '...');
            if (this.onAudioChunkCallback) {
                this.onAudioChunkCallback(sessionId, base64Audio, chunkIndex);
            }
        }
        catch (err) {
            if (err.name === 'AbortError') {
                console.log(`[SarvamTTSService] [Session: ${sessionId}] TTS synthesis chunk #${chunkIndex} aborted.`);
            }
            else {
                console.error(`[SarvamTTSService] [Session: ${sessionId}] TTS synthesis error:`, err.message);
                throw err;
            }
        }
        finally {
            this.activeControllers.delete(controllerKey);
        }
    }
    /**
     * Cancel any ongoing text-to-speech generation.
     * Highly crucial for handling user interruption events.
     */
    cancelSynthesis(sessionId) {
        console.log(`[SarvamTTSService] [Session: ${sessionId}] Cancelling active synthesization.`);
        for (const [key, controller] of this.activeControllers.entries()) {
            if (key.startsWith(`${sessionId}_`)) {
                controller.abort();
                this.activeControllers.delete(key);
            }
        }
    }
}
