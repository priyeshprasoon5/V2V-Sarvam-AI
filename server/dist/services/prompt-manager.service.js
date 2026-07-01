import { SYSTEM_PROMPTS } from '../config/prompts.js';
export class PromptManagerService {
    currentPromptKey = 'default';
    /**
     * Retrieve the configured system prompt.
     */
    getSystemPrompt(key) {
        return SYSTEM_PROMPTS[key || this.currentPromptKey];
    }
    /**
     * Dynamically switch active system prompt.
     */
    setSystemPromptKey(key) {
        this.currentPromptKey = key;
    }
}
export const promptManager = new PromptManagerService();
