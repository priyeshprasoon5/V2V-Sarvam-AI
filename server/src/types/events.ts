/**
 * Type definitions for the Real-Time WebSocket Event Protocol.
 * These types define the structural contracts between the client and server.
 */

// Basic interface for all event messages
export interface BaseEvent {
  type: string;
  sessionId: string;
  timestamp: string; // ISO 8601 string
}

// 1. Connection Initialization Event (Client -> Server)
export interface ConnectionInitEvent extends BaseEvent {
  type: 'connection:init';
}

// 2. STT Stream Start Event (Client -> Server)
export interface STTStartEvent extends BaseEvent {
  type: 'stt:start';
  language: string; // BCP-47 language code (e.g. 'en-IN', 'hi-IN', 'auto')
  model: string; // e.g. 'saaras:v3'
}

// 3. STT Audio Chunk Event (Client -> Server)
export interface STTAudioEvent extends BaseEvent {
  type: 'stt:audio';
  payload: string; // Base64 encoded audio slice
  chunkIndex: number;
}

// 4. STT Stream Stop Event (Client -> Server)
export interface STTStopEvent extends BaseEvent {
  type: 'stt:stop';
}

// 5. STT Real-time Partial Transcript (Server -> Client)
export interface STTPartialEvent extends BaseEvent {
  type: 'stt:partial';
  transcript: string;
}

// 6. STT Final Transcript segment (Server -> Client)
export interface STTFinalEvent extends BaseEvent {
  type: 'stt:final';
  transcript: string;
  latencyMs?: number; // Metric showing processing lag
}

// 7. STT Service Status (Server -> Client)
export interface STTStatusEvent extends BaseEvent {
  type: 'stt:status';
  status: 'connecting' | 'connected' | 'disconnected' | 'stopped';
  message?: string;
}

// 8. STT Service Error (Server -> Client)
export interface STTErrorEvent extends BaseEvent {
  type: 'stt:error';
  message: string;
}

// 9. Server Acknowledgment Event (Server -> Client)
export interface ServerAckEvent extends BaseEvent {
  type: 'server:ack';
  chunkIndex?: number; // Index of the chunk being acknowledged (if applicable)
  status: 'success' | 'failed';
  message?: string;
}

// 10. Error Event (Server -> Client)
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  message: string;
  code?: string;
}

// === WEEK 1: Legacy Event Declarations (For Backward Compatibility) ===
export interface StreamStartEvent extends BaseEvent {
  type: 'stream:start';
}

export interface AudioChunkEvent extends BaseEvent {
  type: 'audio:chunk';
  payload: string; // Base64 encoded audio chunk
  chunkIndex: number;
}

export interface StreamStopEvent extends BaseEvent {
  type: 'stream:stop';
}

// === WEEK 3 & 4 WEBSOCKET EVENTS ===

export interface LLMStartEvent extends BaseEvent {
  type: 'llm:start';
}

export interface LLMTokenEvent extends BaseEvent {
  type: 'llm:token';
  token: string;
  isFinal: boolean;
}

export interface LLMCompleteEvent extends BaseEvent {
  type: 'llm:complete';
}

export interface LLMErrorEvent extends BaseEvent {
  type: 'llm:error';
  message: string;
}

export interface TTSStartEvent extends BaseEvent {
  type: 'tts:start';
  chunkIndex: number;
}

export interface TTSChunkEvent extends BaseEvent {
  type: 'tts:chunk';
  payload: string; // Base64 audio chunk
  chunkIndex: number;
}

export interface TTSEndEvent extends BaseEvent {
  type: 'tts:end';
  chunkIndex: number;
}

export interface TTSErrorEvent extends BaseEvent {
  type: 'tts:error';
  message: string;
}

export interface AudioStartEvent extends BaseEvent {
  type: 'audio:start';
}

export interface AudioChunkEvent extends BaseEvent {
  type: 'audio:chunk';
  payload: string; // Base64 audio chunk
  chunkIndex: number;
}

export interface AudioEndEvent extends BaseEvent {
  type: 'audio:end';
}

export interface InterruptionStartEvent extends BaseEvent {
  type: 'interruption:start';
}

export interface InterruptionCompleteEvent extends BaseEvent {
  type: 'interruption:complete';
}

// Union of all Client to Server messages
export type ClientMessage =
  | ConnectionInitEvent
  | STTStartEvent
  | STTAudioEvent
  | STTStopEvent
  | StreamStartEvent
  | AudioChunkEvent
  | StreamStopEvent
  | InterruptionStartEvent;

// Union of all Server to Client messages
export type ServerMessage =
  | ServerAckEvent
  | ErrorEvent
  | STTPartialEvent
  | STTFinalEvent
  | STTStatusEvent
  | STTErrorEvent
  | LLMStartEvent
  | LLMTokenEvent
  | LLMCompleteEvent
  | LLMErrorEvent
  | TTSStartEvent
  | TTSChunkEvent
  | TTSEndEvent
  | TTSErrorEvent
  | AudioStartEvent
  | AudioChunkEvent
  | AudioEndEvent
  | InterruptionCompleteEvent;

