/**
 * Manages the dialogue context and history for each session.
 * For Week 1, this holds standard in-memory message stacks.
 * In future weeks, this will be integrated with Redis for state persistence across gateway reboots.
 */
export class ConversationManagerService {
    history = new Map();
    constructor() {
        console.log('[ConversationManagerService] Initialized conversation manager.');
    }
    /**
     * Initialize a system instruction for a new conversation session.
     */
    initializeSession(sessionId, systemPrompt) {
        const defaultPrompt = 'You are a helpful, friendly, and concise voice-to-voice AI assistant powered by Sarvam AI.';
        const initialMessages = [
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
    addMessage(sessionId, role, content) {
        let sessionHistory = this.history.get(sessionId);
        if (!sessionHistory) {
            sessionHistory = this.initializeSession(sessionId);
        }
        const newMessage = {
            role,
            content,
            timestamp: new Date(),
        };
        sessionHistory.push(newMessage);
        console.log(`[ConversationManagerService] [Session: ${sessionId}] Added message role: "${role}", length: ${content.length}`);
        return newMessage;
    }
    /**
     * Retrieve full conversation history.
     */
    getHistory(sessionId) {
        return this.history.get(sessionId) || this.initializeSession(sessionId);
    }
    /**
     * Delete conversation history.
     */
    clearHistory(sessionId) {
        this.history.delete(sessionId);
        console.log(`[ConversationManagerService] [Session: ${sessionId}] Cleared dialogue history.`);
    }
}
export const conversationManager = new ConversationManagerService();
