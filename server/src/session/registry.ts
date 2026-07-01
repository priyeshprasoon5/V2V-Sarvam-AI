import { WebSocket } from 'ws';

export interface Session {
  sessionId: string;
  socket: WebSocket;
  createdAt: Date;
  lastActive: Date;
  isStreaming: boolean;
  chunkCount: number;
  totalBytesReceived: number;
  metadata?: Record<string, any>;
}

/**
 * Singleton SessionRegistry to manage all live voice connections.
 * This class will lay the groundwork for future Redis session databases.
 */
export class SessionRegistry {
  private static instance: SessionRegistry;
  private sessions: Map<string, Session> = new Map();

  private constructor() {}

  public static getInstance(): SessionRegistry {
    if (!SessionRegistry.instance) {
      SessionRegistry.instance = new SessionRegistry();
    }
    return SessionRegistry.instance;
  }

  /**
   * Register a new user session or retrieve an existing one if the socket matches.
   */
  public registerSession(sessionId: string, socket: WebSocket): Session {
    let session = this.sessions.get(sessionId);

    if (session) {
      // Session exists, update the socket connection and update activity time
      session.socket = socket;
      session.lastActive = new Date();
      console.log(`[SessionRegistry] Reassociated socket for session: ${sessionId}`);
    } else {
      // Create new session entry
      session = {
        sessionId,
        socket,
        createdAt: new Date(),
        lastActive: new Date(),
        isStreaming: false,
        chunkCount: 0,
        totalBytesReceived: 0,
        metadata: {},
      };
      this.sessions.set(sessionId, session);
      console.log(`[SessionRegistry] Created new session registry entry: ${sessionId}`);
    }

    return session;
  }

  /**
   * Get an active session by ID.
   */
  public getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActive = new Date(); // Update activity check
    }
    return session;
  }

  /**
   * Update the streaming state of a session.
   */
  public setStreamingState(sessionId: string, isStreaming: boolean): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isStreaming = isStreaming;
      session.lastActive = new Date();
      if (!isStreaming) {
        // Reset counter when stopping stream
        session.chunkCount = 0;
      }
      return true;
    }
    return false;
  }

  /**
   * Record a received audio chunk, incrementing metrics.
   */
  public incrementChunkMetrics(sessionId: string, byteLength: number): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.chunkCount += 1;
      session.totalBytesReceived += byteLength;
      session.lastActive = new Date();
      return session;
    }
    return undefined;
  }

  /**
   * Remove a session when the user disconnects, ensuring all active proxy sockets are stopped.
   */
  public removeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      const sttService = session.metadata?.sttService;
      if (sttService) {
        sttService.stopStream(sessionId).catch((err: any) => {
          console.error(`[SessionRegistry] Error stopping STT socket for session ${sessionId}:`, err.message);
        });
      }
    }
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(`[SessionRegistry] Disconnected and cleaned up session: ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Retrieve list of all active session IDs.
   */
  public getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Helper to clean up any abandoned sessions that haven't sent keepalives (garbage collection).
   * Useful for avoiding memory leaks in a production environment.
   */
  public cleanupExpiredSessions(timeoutMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActive.getTime() > timeoutMs) {
        console.log(`[SessionRegistry] Expiring idle session: ${id}`);
        // Close socket if open
        if (session.socket.readyState === WebSocket.OPEN) {
          session.socket.close(1008, 'Session idle timeout');
        }
        this.sessions.delete(id);
      }
    }
  }
}

export const sessionRegistry = SessionRegistry.getInstance();
