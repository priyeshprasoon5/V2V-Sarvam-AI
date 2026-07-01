import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { sessionRegistry } from '../session/registry.js';
import { handleClientMessage } from './handler.js';
import { ClientMessage } from '../types/events.js';

/**
 * WebSocketManager handles the low-level socket connections, heartbeats,
 * event parsing, and graceful cleanup of client connections.
 */
export class WebSocketManager {
  private static instance: WebSocketManager;

  private constructor() {}

  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * Handle incoming WebSocket connections from Fastify.
   */
  public handleConnection(socket: WebSocket, request: IncomingMessage): void {
    console.log(`[WS Manager] New raw WebSocket connection initiated from IP: ${request.socket.remoteAddress}`);

    let activeSessionId: string | null = null;

    // Set up standard ping/pong check
    let isAlive = true;
    socket.on('pong', () => {
      isAlive = true;
    });

    // 1. Message Event Listener
    socket.on('message', async (data: Buffer | string) => {
      isAlive = true; // Reset heartbeat keep-alive: any message received means the connection is active
      try {
        let messageString: string;
        
        if (Buffer.isBuffer(data)) {
          messageString = data.toString('utf-8');
        } else {
          messageString = data;
        }

        const event: ClientMessage = JSON.parse(messageString);
        
        // Ensure the event contains standard payload information
        if (!event || !event.type || !event.sessionId) {
          throw new Error('Invalid message payload: missing event "type" or "sessionId"');
        }

        // Remember the session ID for disconnect cleanup
        activeSessionId = event.sessionId;

        // Process message via event handlers
        await handleClientMessage(socket, event);
      } catch (err: any) {
        console.error('[WS Manager] Error parsing incoming WS message:', err.message);
        
        // Emit error back to the client
        this.sendError(socket, activeSessionId || 'unknown', `Failed to parse message: ${err.message}`);
      }
    });

    // 2. Error Event Listener
    socket.on('error', (err) => {
      console.error(`[WS Manager] Socket error on session ${activeSessionId || 'unknown'}:`, err.message);
    });

    // 3. Socket Close Event Listener
    socket.on('close', (code, reason) => {
      console.log(`[WS Manager] Socket closed. Code: ${code}, Reason: ${reason || 'None'}`);
      clearInterval(heartbeatInterval);
      if (activeSessionId) {
        this.cleanupSession(activeSessionId, socket);
      }
    });

    // 4. Setup heartbeat interval
    const heartbeatInterval = setInterval(() => {
      if (isAlive === false) {
        console.warn(`[WS Manager] Session ${activeSessionId || 'unknown'} failed heartbeat. Terminating.`);
        socket.terminate();
        clearInterval(heartbeatInterval);
        if (activeSessionId) {
          this.cleanupSession(activeSessionId, socket);
        }
        return;
      }

      isAlive = false;
      socket.ping();
    }, 30000); // 30 second interval
  }

  /**
   * Cleans up all registry information, open sockets, and intervals associated with a session.
   * Only deletes registry entries if the registered session corresponds to the socket being cleaned.
   */
  private cleanupSession(sessionId: string, socket: WebSocket): void {
    // Only clean registry entries if the current session socket is the one that's closing.
    // This prevents stale/closed connection cleanups from removing newly established re-connections.
    const activeSession = sessionRegistry.getSession(sessionId);
    if (activeSession && activeSession.socket === socket) {
      sessionRegistry.removeSession(sessionId);
    } else {
      console.log(
        `[WS Manager] Skip registry removal for session: ${sessionId}. ` +
        `The session has been re-associated with another active connection.`
      );
    }
  }

  /**
   * Helper to send an error packet to a client.
   */
  private sendError(socket: WebSocket, sessionId: string, message: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          message,
        })
      );
    }
  }
}

export const wsManager = WebSocketManager.getInstance();
