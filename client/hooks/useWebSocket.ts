import { useState, useEffect, useRef, useCallback } from 'react';
import { getOrCreateSessionId } from '../lib/utils';
import { ClientMessage, ServerMessage } from '../types/websocket';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface LogItem {
  id: string;
  timestamp: string;
  direction: 'in' | 'out';
  type: string;
  data: string;
}

interface UseWebSocketProps {
  url: string;
  onMessageReceived?: (message: ServerMessage) => void;
}

/**
 * A custom React hook that manages the raw WebSocket connection lifecycle.
 * Handles auto-init (connection:init) on open and logs transit events.
 */
export function useWebSocket({ url, onMessageReceived }: UseWebSocketProps) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string>('');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  /**
   * Add a log entry to the UI event monitor panel.
   */
  const addLog = useCallback((direction: 'in' | 'out', type: string, payload: any) => {
    const newLog: LogItem = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      direction,
      type,
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    };
    setLogs((prev) => [newLog, ...prev].slice(0, 100)); // Cap logs at 100 entries
  }, []);

  /**
   * Connect to the backend WebSocket server.
   */
  const connect = useCallback(() => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      console.log('[useWebSocket] Socket is already connected or connecting.');
      return;
    }

    setStatus('connecting');
    console.log(`[useWebSocket] Connecting to: ${url}`);

    const id = getOrCreateSessionId();
    setSessionId(id);

    try {
      const socket = new WebSocket(url);
	(window as any).ws = socket;
      socketRef.current = socket;

      // 1. Connection Opened
      socket.onopen = () => {
        setStatus('connected');
        console.log('[useWebSocket] Socket connection established.');

        // Immediately send connection:init to associate the socket with this Session ID
        const initEvent: ClientMessage = {
          type: 'connection:init',
          sessionId: id,
          timestamp: new Date().toISOString(),
        };
        send(initEvent);
      };

      // 2. Incoming Message Received
      socket.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);
          
          if (message.type === 'tts:chunk' || message.type === 'audio:chunk') {
            addLog('in', message.type, {
              ...message,
              payload: `${message.payload.length} chars (Base64)`,
            });
          } else {
            addLog('in', message.type, message);
          }

          // Handle server error messages
          if (message.type === 'error') {
            console.error('[useWebSocket] Server error received:', message.message);
          }

          // Trigger custom callback
          if (onMessageReceived) {
            onMessageReceived(message);
          }
        } catch (err) {
          console.error('[useWebSocket] Error parsing server message:', err);
          addLog('in', 'unknown-raw', event.data);
        }
      };

      // 3. Connection Error
      socket.onerror = (error) => {
        console.error('[useWebSocket] Socket error event:', error);
        setStatus('error');
      };

      // 4. Connection Closed
      socket.onclose = (event) => {
        console.log(`[useWebSocket] Socket closed. Code: ${event.code}, Clean: ${event.wasClean}`);
        setStatus('disconnected');
      };
    } catch (err: any) {
      console.error('[useWebSocket] Failed to instantiate WebSocket:', err);
      setStatus('error');
    }
  }, [url, onMessageReceived, addLog]);

  /**
   * Disconnect from the WebSocket server.
   */
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log('[useWebSocket] Manually closing WebSocket...');
      socketRef.current.close(1000, 'User requested disconnect');
      socketRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  /**
   * Send typed messages to the backend.
   */
  const send = useCallback((message: ClientMessage) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[useWebSocket] Cannot send message: socket is not open.');
      return false;
    }

    try {
      socketRef.current.send(JSON.stringify(message));
      
      // Log outgoing message (truncate large payloads like base64 chunks for visual neatness)
      if (message.type === 'audio:chunk' || message.type === 'stt:audio') {
        const payloadLength = message.payload.length;
        addLog('out', message.type, {
          ...message,
          payload: `${payloadLength} characters (Base64)`,
        });
      } else {
        addLog('out', message.type, message);
      }
      return true;
    } catch (err) {
      console.error('[useWebSocket] Error sending message over WS:', err);
      return false;
    }
  }, [addLog]);

  // Clean up socket on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close(1000, 'Component unmounted');
      }
    };
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    status,
    sessionId,
    logs,
    connect,
    disconnect,
    send,
    clearLogs,
  };
}
export default useWebSocket;
