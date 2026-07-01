export interface TranscriptItem {
  streamId: string;
  sessionId: string;
  transcript: string;
  timestamp: Date;
  speechDurationMs: number;
  latencyMs: number;
}

/**
 * TranscriptManagerService manages the history of generated transcripts
 * for each user session, tracking performance metrics like latency.
 */
export class TranscriptManagerService {
  private static instance: TranscriptManagerService;
  private sessionTranscripts: Map<string, TranscriptItem[]> = new Map();

  private constructor() {}

  public static getInstance(): TranscriptManagerService {
    if (!TranscriptManagerService.instance) {
      TranscriptManagerService.instance = new TranscriptManagerService();
    }
    return TranscriptManagerService.instance;
  }

  /**
   * Record a new finalized transcript segment along with performance metrics.
   */
  public addTranscript(
    sessionId: string,
    streamId: string,
    transcript: string,
    speechDurationMs: number,
    latencyMs: number
  ): TranscriptItem {
    let transcripts = this.sessionTranscripts.get(sessionId);
    if (!transcripts) {
      transcripts = [];
      this.sessionTranscripts.set(sessionId, transcripts);
    }

    const newItem: TranscriptItem = {
      streamId,
      sessionId,
      transcript,
      timestamp: new Date(),
      speechDurationMs,
      latencyMs,
    };

    transcripts.push(newItem);

    console.log(
      `[TranscriptManager] [Session: ${sessionId}] Added Final Transcript Segment: \n` +
      `  - Text: "${transcript}"\n` +
      `  - Speech Duration: ${speechDurationMs}ms\n` +
      `  - STT Latency: ${latencyMs}ms`
    );

    return newItem;
  }

  /**
   * Retrieve all transcription history for a session.
   */
  public getTranscripts(sessionId: string): TranscriptItem[] {
    return this.sessionTranscripts.get(sessionId) || [];
  }

  /**
   * Clear all transcription history for a session.
   */
  public clearTranscripts(sessionId: string): void {
    this.sessionTranscripts.delete(sessionId);
    console.log(`[TranscriptManager] [Session: ${sessionId}] Cleared transcription history.`);
  }
}

export const transcriptManager = TranscriptManagerService.getInstance();
