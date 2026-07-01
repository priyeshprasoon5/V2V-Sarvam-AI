export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

/**
 * Manages the dialogue context and history for each session.
 * For Week 1, this holds standard in-memory message stacks.
 * In future weeks, this will be integrated with Redis for state persistence across gateway reboots.
 */
export class ConversationManagerService {
  private history: Map<string, Message[]> = new Map();

  constructor() {
    console.log('[ConversationManagerService] Initialized conversation manager.');
  }

  /**
   * Initialize a system instruction for a new conversation session.
   */
  public initializeSession(sessionId: string, systemPrompt?: string): Message[] {
    const defaultPrompt = 'You are a helpful, friendly, and concise voice-to-voice AI assistant powered by Sarvam AI.';
    const initialMessages: Message[] = [
      {
        role: 'system',
        content: systemPrompt || defaultPrompt,
        timestamp: new Date(),
      },
    ];
    this.history.set(sessionId, initialMessages);
    console.log(`[ConversationManagerService] [Session: ${sessionId}] Initialized dialogue history.`);
    return initialMessages;
  }

  /**
   * Append a new message to the history.
   */
  public addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): Message {
    let sessionHistory = this.history.get(sessionId);
    if (!sessionHistory) {
      sessionHistory = this.initializeSession(sessionId);
    }

    const newMessage: Message = {
      role,
      content,
      timestamp: new Date(),
    };
    sessionHistory.push(newMessage);
    console.log(
      `[ConversationManagerService] [Session: ${sessionId}] Added message role: "${role}", length: ${content.length}`
    );
    return newMessage;
  }

  /**
   * Retrieve full conversation history.
   */
  public getHistory(sessionId: string): Message[] {
    return this.history.get(sessionId) || this.initializeSession(sessionId);
  }

  /**
   * Delete conversation history.
   */
  public clearHistory(sessionId: string): void {
    this.history.delete(sessionId);
    console.log(`[ConversationManagerService] [Session: ${sessionId}] Cleared dialogue history.`);
  }
}

export const conversationManager = new ConversationManagerService();
