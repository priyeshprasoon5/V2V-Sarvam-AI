export interface SessionMetrics {
  sttLatencyMs?: number;
  llmStartMs?: number;
  llmFirstTokenMs?: number;
  llmEndMs?: number;
  ttsRequests: Map<number, { start: number; end?: number }>;
  totalStartMs?: number;
  totalFirstAudioMs?: number;
  totalEndMs?: number;
}

export class LatencyTrackerService {
  private metrics: Map<string, SessionMetrics> = new Map();

  /**
   * Initialize a new turn's metrics tracking.
   */
  public startTurn(sessionId: string, sttLatencyMs?: number) {
    const now = Date.now();
    this.metrics.set(sessionId, {
      sttLatencyMs,
      totalStartMs: now,
      ttsRequests: new Map(),
    });
  }

  public recordLLMStart(sessionId: string) {
    const m = this.metrics.get(sessionId);
    if (m) m.llmStartMs = Date.now();
  }

  public recordLLMFirstToken(sessionId: string) {
    const m = this.metrics.get(sessionId);
    if (m && !m.llmFirstTokenMs) {
      m.llmFirstTokenMs = Date.now();
      if (m.totalStartMs) {
        m.totalFirstAudioMs = Date.now();
      }
    }
  }

  public recordLLMEnd(sessionId: string) {
    const m = this.metrics.get(sessionId);
    if (m) m.llmEndMs = Date.now();
  }

  public recordTTSStart(sessionId: string, chunkIndex: number) {
    const m = this.metrics.get(sessionId);
    if (m) {
      m.ttsRequests.set(chunkIndex, { start: Date.now() });
    }
  }

  public recordTTSEnd(sessionId: string, chunkIndex: number) {
    const m = this.metrics.get(sessionId);
    if (m) {
      const req = m.ttsRequests.get(chunkIndex);
      if (req) {
        req.end = Date.now();
      }
    }
  }

  /**
   * Calculate and log turn latencies to stdout.
   */
  public endTurn(sessionId: string) {
    const m = this.metrics.get(sessionId);
    if (!m) return;

    m.totalEndMs = Date.now();

    const stt = m.sttLatencyMs ?? 0;
    const llmStart = m.llmStartMs ?? 0;
    const llmFirstToken = m.llmFirstTokenMs ?? 0;
    const llmEnd = m.llmEndMs ?? 0;
    const totalStart = m.totalStartMs ?? 0;
    const totalEnd = m.totalEndMs ?? 0;

    const llmLatency = llmFirstToken ? (llmFirstToken - llmStart) : 0;
    const llmTotalDuration = llmEnd ? (llmEnd - llmStart) : 0;
    const totalLatency = totalEnd - totalStart;

    console.log(`\n================ LATENCY METRICS [Session: ${sessionId}] ================`);
    console.log(`* STT Latency:          ${stt}ms`);
    console.log(`* LLM Time to 1st Token: ${llmLatency}ms`);
    console.log(`* LLM Total Stream:     ${llmTotalDuration}ms`);
    
    let avgTts = 0;
    let ttsCount = 0;
    let ttsDetails = '';
    for (const [idx, req] of m.ttsRequests.entries()) {
      if (req.end) {
        const diff = req.end - req.start;
        avgTts += diff;
        ttsCount++;
        ttsDetails += `  - Chunk #${idx}: ${diff}ms\n`;
      }
    }
    if (ttsCount > 0) {
      avgTts = Math.round(avgTts / ttsCount);
      console.log(`* TTS Average Latency:  ${avgTts}ms (for ${ttsCount} chunks)`);
      console.log(ttsDetails.trimEnd());
    } else {
      console.log(`* TTS Average Latency:  N/A`);
    }
    console.log(`* Total Turn Duration:  ${totalLatency}ms`);
    console.log(`==================================================================\n`);
    
    // Clear metrics for this turn
    this.metrics.delete(sessionId);
  }
}

export const latencyTracker = new LatencyTrackerService();
