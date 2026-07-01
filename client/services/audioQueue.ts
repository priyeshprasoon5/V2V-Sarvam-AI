/**
 * A queue-based client audio player to process and play streamed audio chunks.
 * Handles gapless playback by scheduling audio buffers to play sequentially
 * using the Web Audio API.
 */
export class AudioQueue {
  private audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private isPlaying: boolean = false;
  private onPlaybackStateChange?: (playing: boolean) => void;

  constructor(onPlaybackStateChange?: (playing: boolean) => void) {
    this.onPlaybackStateChange = onPlaybackStateChange;
  }

  /**
   * Decode base64 audio payload and enqueue it for gapless playback.
   */
  public async enqueueChunk(base64Payload: string): Promise<void> {
    try {
      // Initialize AudioContext on first chunk due to browser autoplay policies
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Convert base64 to binary ArrayBuffer
      const binaryString = window.atob(base64Payload);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

// Try to decode via AudioContext first
    try {
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      console.log('[AudioQueue] Decoded via AudioContext, playing buffer');
      this.playBuffer(audioBuffer);
    } catch (decodeErr) {
      // Determine MIME type based on header bytes (WAV vs MP3)
      const header = new Uint8Array(arrayBuffer.slice(0, 4));
      let mime = 'audio/mpeg'; // default
      if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
        // 'RIFF' => WAV file
        mime = 'audio/wav';
      }
      console.warn('[AudioQueue] decodeAudioData failed, attempting Blob fallback with mime', mime, decodeErr);
      const tryPlayBlob = async (mimeType: string) => {
        const blob = new Blob([arrayBuffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.setIsPlaying(true);
        console.log('[AudioQueue] Playing audio via Blob MIME', mimeType, 'size', blob.size);
        try {
          await audio.play();
          console.log('[AudioQueue] Playback started successfully');
        } catch (playErr) {
          console.error('[AudioQueue] Playback error for MIME', mimeType, playErr);
        } finally {
          audio.onended = () => this.setIsPlaying(false);
          audio.addEventListener('ended', () => URL.revokeObjectURL(url));
        }
      };
      try {
        await tryPlayBlob(mime);
      } catch (err1) {
        console.warn('[AudioQueue] Playback with detected MIME failed, trying fallback MP3 then WAV', err1);
        try {
          await tryPlayBlob('audio/mpeg');
        } catch (err2) {
          try {
            await tryPlayBlob('audio/wav');
          } catch (err3) {
            console.error('[AudioQueue] All playback attempts failed:', err3);
          }
        }
      }
    }
    return;
    } catch (err) {
      console.error('[AudioQueue] Error decoding/playing audio chunk:', err);
    }
  }

  /**
   * Schedule the buffer to play sequentially using AudioContext timing.
   */
  private playBuffer(audioBuffer: AudioBuffer) {
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;

    // If we are behind or haven't scheduled anything yet, align with now
    if (this.nextStartTime < now) {
      this.nextStartTime = now;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Schedule start at the calculated time
    source.start(this.nextStartTime);
    this.activeSources.push(source);
    
    this.setIsPlaying(true);

    // Track when this buffer ends to remove from active sources and update state
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0) {
        this.setIsPlaying(false);
      }
    };

    // Advance next start time by buffer duration to schedule next chunk gaplessly
    this.nextStartTime += audioBuffer.duration;
  }

  /**
   * Stop all active playback, clear the source list, and reset schedule timing.
   */
  public stop() {
    console.log('[AudioQueue] Stopping all active sources and clearing queue');
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (err) {
        // Source might have already finished
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
    this.setIsPlaying(false);
  }

  private setIsPlaying(playing: boolean) {
    if (this.isPlaying !== playing) {
      this.isPlaying = playing;
      if (this.onPlaybackStateChange) {
        this.onPlaybackStateChange(playing);
      }
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
