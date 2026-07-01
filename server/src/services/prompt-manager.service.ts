import { SYSTEM_PROMPTS } from '../config/prompts.js';

export class PromptManagerService {
  private currentPromptKey: keyof typeof SYSTEM_PROMPTS = 'default';

  /**
   * Retrieve the configured system prompt.
   */
  public getSystemPrompt(key?: keyof typeof SYSTEM_PROMPTS): string {
    return SYSTEM_PROMPTS[key || this.currentPromptKey];
  }

  /**
   * Dynamically switch active system prompt.
   */
  public setSystemPromptKey(key: keyof typeof SYSTEM_PROMPTS): void {
    this.currentPromptKey = key;
  }
}

export const promptManager = new PromptManagerService();
