// AudioWorklet processors as source strings — loaded via Blob URLs at runtime
// so the lib needs no static-asset plumbing in consuming apps.

/** Runs in an AudioContext({sampleRate: 16000}); posts Int16 PCM chunks (~32ms). */
export const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(512);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer.slice(0));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('aven-voice-capture', CaptureProcessor);
`

/**
 * Runs in an AudioContext({sampleRate: 24000}). Queues Int16 PCM; 'clear'
 * flushes on barge-in. ~100ms jitter buffer prevents mid-word dropouts when
 * chunks arrive just-in-time (without it, tail words lose phonemes).
 */
export const PLAYBACK_WORKLET = `
const JITTER_SAMPLES = 2400;
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.buffered = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      if (e.data === 'clear') {
        this.queue = [];
        this.current = null;
        this.offset = 0;
        this.buffered = 0;
        this.playing = false;
      } else {
        const chunk = new Int16Array(e.data);
        this.queue.push(chunk);
        this.buffered += chunk.length;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.buffered >= JITTER_SAMPLES) this.playing = true;
    if (!this.playing) { out.fill(0); return true; }
    for (let i = 0; i < out.length; i++) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() ?? null;
        this.offset = 0;
        if (!this.current) {
          this.playing = false;
          this.buffered = 0;
          out.fill(0, i);
          return true;
        }
      }
      out[i] = this.current[this.offset++] / 32768;
      this.buffered--;
    }
    return true;
  }
}
registerProcessor('aven-voice-playback', PlaybackProcessor);
`

export function workletUrl(source: string): string {
	return URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
}
