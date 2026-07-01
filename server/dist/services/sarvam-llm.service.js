/**
 * Service to interface with Sarvam LLM endpoints (e.g. Chat Completions).
 * This class supports streaming conversational AI responses and handles session-based cancellations.
 */
export class SarvamLLMService {
    config;
    onTokenCallback;
    activeControllers = new Map();
    constructor(config) {
        this.config = config;
        console.log('[SarvamLLMService] Initialized service with endpoint:', config.endpoint);
    }
    /**
     * Register a listener for streaming token output.
     */
    onToken(callback) {
        this.onTokenCallback = callback;
    }
    /**
     * Send messages array to Sarvam LLM and stream tokens back.
     */
    async generateStreamingResponse(sessionId, messages) {
        console.log(`[SarvamLLMService] [Session: ${sessionId}] Requesting LLM response stream for history length: ${messages.length}`);
        // Cancel any existing request for this session
        this.cancelGeneration(sessionId);
        const controller = new AbortController();
        this.activeControllers.set(sessionId, controller);
        try {
            // Allow model to be overrideable via env (default to sarvam-30b)
            const model = process.env.SARVAM_LLM_MODEL || 'sarvam-30b';
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'api-subscription-key': this.config.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: messages.map((m) => ({ role: m.role, content: m.content })),
                    temperature: 0.7,
                    max_tokens: 500,
                    stream: true,
                    reasoning_effort: null, // Request fastest response and disable reasoning
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sarvam LLM API returned status ${response.status}: ${errorText}`);
            }
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Sarvam LLM response body reader is not available');
            }
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let inThinkingBlock = false;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep the partial last line
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    if (trimmed.startsWith('data: ')) {
                        const dataContent = trimmed.slice(6).trim();
                        if (dataContent === '[DONE]') {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(dataContent);
                            const delta = parsed.choices?.[0]?.delta;
                            let token = delta?.content || delta?.reasoning_content || '';
                            if (token) {
                                // Strip <think>...</think> tags and content within them if present
                                if (token.includes('<think>')) {
                                    inThinkingBlock = true;
                                    token = token.split('<think>')[0];
                                }
                                if (inThinkingBlock) {
                                    if (token.includes('</think>')) {
                                        inThinkingBlock = false;
                                        token = token.split('</think>')[1] || '';
                                    }
                                    else {
                                        token = '';
                                    }
                                }
                                if (token && this.onTokenCallback) {
                                    this.onTokenCallback(sessionId, token, false);
                                }
                            }
                        }
                        catch (err) {
                            console.error(`[SarvamLLMService] Error parsing streaming SSE chunk: ${err.message}`, trimmed);
                        }
                    }
                }
            }
            // Process remaining buffer
            if (buffer && buffer.startsWith('data: ')) {
                const dataContent = buffer.slice(6).trim();
                if (dataContent !== '[DONE]') {
                    try {
                        const parsed = JSON.parse(dataContent);
                        const delta = parsed.choices?.[0]?.delta;
                        let token = delta?.content || delta?.reasoning_content || '';
                        if (token) {
                            if (token.includes('<think>')) {
                                inThinkingBlock = true;
                                token = token.split('<think>')[0];
                            }
                            if (inThinkingBlock) {
                                if (token.includes('</think>')) {
                                    inThinkingBlock = false;
                                    token = token.split('</think>')[1] || '';
                                }
                                else {
                                    token = '';
                                }
                            }
                            if (token && this.onTokenCallback) {
                                this.onTokenCallback(sessionId, token, false);
                            }
                        }
                    }
                    catch (e) { }
                }
            }
            // Signal stream completion
            if (this.onTokenCallback) {
                this.onTokenCallback(sessionId, '', true);
            }
        }
        catch (err) {
            if (err.name === 'AbortError') {
                console.log(`[SarvamLLMService] [Session: ${sessionId}] LLM response stream aborted.`);
            }
            else {
                console.error(`[SarvamLLMService] [Session: ${sessionId}] Error during LLM generation:`, err.message);
                throw err;
            }
        }
        finally {
            this.activeControllers.delete(sessionId);
        }
    }
    /**
     * Cancel the active LLM generation stream.
     * Crucial for user interruption.
     */
    cancelGeneration(sessionId) {
        const controller = this.activeControllers.get(sessionId);
        if (controller) {
            console.log(`[SarvamLLMService] [Session: ${sessionId}] Cancelling active LLM generation.`);
            controller.abort();
            this.activeControllers.delete(sessionId);
        }
    }
}
