/**
 * VoiceEngine — Text-to-speech for navigation guidance.
 * Uses Web Speech API with deduplication, throttling, and graceful fallback.
 */

export class VoiceEngine {
  private synth: SpeechSynthesis | null = null;
  private enabled = true;
  private lastSpoken = '';
  private lastSpokeAt = 0;
  private throttleMs = 3000; // min ms between announcements
  private supported = false;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.supported = true;
    }
  }

  get isSupported(): boolean {
    return this.supported;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
  }

  /** Speak text. Deduplicates identical consecutive messages and throttles. */
  speak(text: string): void {
    if (!this.enabled || !this.synth || !this.supported) return;

    const now = Date.now();
    // Deduplicate
    if (text === this.lastSpoken && now - this.lastSpokeAt < this.throttleMs * 2) return;
    // Throttle
    if (now - this.lastSpokeAt < this.throttleMs) return;

    // Cancel any ongoing speech
    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    this.synth.speak(utterance);
    this.lastSpoken = text;
    this.lastSpokeAt = now;
  }

  /** Force speak, bypassing dedup/throttle (for critical announcements). */
  speakImmediate(text: string): void {
    if (!this.enabled || !this.synth || !this.supported) return;
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.lang = 'en-US';
    this.synth.speak(utterance);
    this.lastSpoken = text;
    this.lastSpokeAt = Date.now();
  }

  stop(): void {
    this.synth?.cancel();
  }

  setThrottle(ms: number): void {
    this.throttleMs = ms;
  }
}
