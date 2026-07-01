/**
 * TranscriptManagerService manages the history of generated transcripts
 * for each user session, tracking performance metrics like latency.
 */
export class TranscriptManagerService {
    static instance;
    sessionTranscripts = new Map();
    constructor() { }
    static getInstance() {
        if (!TranscriptManagerService.instance) {
            TranscriptManagerService.instance = new TranscriptManagerService();
        }
        return TranscriptManagerService.instance;
    }
    /**
     * Record a new finalized transcript segment along with performance metrics.
     */
    addTranscript(sessionId, streamId, transcript, speechDurationMs, latencyMs) {
        let transcripts = this.sessionTranscripts.get(sessionId);
        if (!transcripts) {
            transcripts = [];
            this.sessionTranscripts.set(sessionId, transcripts);
        }
        const newItem = {
            streamId,
            sessionId,
            transcript,
            timestamp: new Date(),
            speechDurationMs,
            latencyMs,
        };
        transcripts.push(newItem);
        console.log(`[TranscriptManager] [Session: ${sessionId}] Added Final Transcript Segment: \n` +
            `  - Text: "${transcript}"\n` +
            `  - Speech Duration: ${speechDurationMs}ms\n` +
            `  - STT Latency: ${latencyMs}ms`);
        return newItem;
    }
    /**
     * Retrieve all transcription history for a session.
     */
    getTranscripts(sessionId) {
        return this.sessionTranscripts.get(sessionId) || [];
    }
    /**
     * Clear all transcription history for a session.
     */
    clearTranscripts(sessionId) {
        this.sessionTranscripts.delete(sessionId);
        console.log(`[TranscriptManager] [Session: ${sessionId}] Cleared transcription history.`);
    }
}
export const transcriptManager = TranscriptManagerService.getInstance();
