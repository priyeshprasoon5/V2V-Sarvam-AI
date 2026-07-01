/**
 * Utility functions for client session management and formatting.
 */

/**
 * Generates a RFC4122 version 4 compliant UUID.
 * Built-in fallback helper for browsers without crypto.randomUUID.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // Fallback UUID generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Retrieves a persistent session ID from sessionStorage.
 * Creates one if not present, ensuring session persistence across tab refreshes.
 */
export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const STORAGE_KEY = 'v2v_ai_session_id';
  let sessionId = sessionStorage.getItem(STORAGE_KEY);

  if (!sessionId) {
    sessionId = generateUUID();
    sessionStorage.setItem(STORAGE_KEY, sessionId);
    console.log(`[Session] Initialized new persistent Session ID: ${sessionId}`);
  } else {
    console.log(`[Session] Found existing persistent Session ID: ${sessionId}`);
  }

  return sessionId;
}

/**
 * Formats a byte size into readable size strings (e.g. KB, MB).
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
