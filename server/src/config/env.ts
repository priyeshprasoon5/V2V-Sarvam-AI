import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve filename and directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the server root directory (two levels up from src/config)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface Config {
  PORT: number;
  HOST: string;
  SARVAM_API_KEY: string;
  SARVAM_STT_ENDPOINT: string;
  SARVAM_TTS_ENDPOINT: string;
  SARVAM_LLM_ENDPOINT: string;
}

/**
 * Validates and extracts required environment variables.
 * Designed to be clean and descriptive for beginners, throwing clear errors if variables are missing.
 */
function validateConfig(): Config {
  const errors: string[] = [];

  const portStr = process.env.PORT || '5000';
  const PORT = parseInt(portStr, 10);
  if (isNaN(PORT)) {
    errors.push(`PORT must be a number, received: "${portStr}"`);
  }

  const HOST = process.env.HOST || '127.0.0.1';

  // Sarvam API Key
  const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
  if (!SARVAM_API_KEY) {
    errors.push('SARVAM_API_KEY is not defined in environment variables');
  }

  // Endpoints with defaults
  const SARVAM_STT_ENDPOINT = process.env.SARVAM_STT_ENDPOINT || 'https://api.sarvam.ai/speech-to-text';
  const SARVAM_TTS_ENDPOINT = process.env.SARVAM_TTS_ENDPOINT || 'https://api.sarvam.ai/text-to-speech';
  const SARVAM_LLM_ENDPOINT = process.env.SARVAM_LLM_ENDPOINT || 'https://api.sarvam.ai/v1/chat/completions';

  if (errors.length > 0) {
    console.error('❌ Environment validation failed:');
    errors.forEach((err) => console.error(`  - ${err}`));
    throw new Error('Invalid environment configuration');
  }

  return {
    PORT,
    HOST,
    SARVAM_API_KEY: SARVAM_API_KEY || '',
    SARVAM_STT_ENDPOINT,
    SARVAM_TTS_ENDPOINT,
    SARVAM_LLM_ENDPOINT,
  };
}

export const config = validateConfig();
