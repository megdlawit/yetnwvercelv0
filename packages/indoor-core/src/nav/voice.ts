// Spoken guidance. Navigation always wins: a new instruction cuts off the
// one before. English uses the device's voice; Amharic uses an Amharic voice
// when the device has one, otherwise a soft two-note chime plays and the
// words stay on screen (most devices ship no Amharic voice).

import type { Lang } from '../model';

export interface SpeakerOptions {
  /** Start muted. */
  muted?: boolean;
  /** Rate 0.5–1.5 (default 1). */
  rate?: number;
}

export class Speaker {
  muted: boolean;
  rate: number;
  private synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  private voices: SpeechSynthesisVoice[] = [];
  private audio: AudioContext | null = null;
  private onVoices = () => { this.voices = this.synth?.getVoices() ?? []; };

  constructor(opts: SpeakerOptions = {}) {
    this.muted = !!opts.muted;
    this.rate = opts.rate ?? 1;
    if (this.synth) { this.onVoices(); this.synth.addEventListener?.('voiceschanged', this.onVoices); }
  }

  /** Can this device say things in this language? */
  hasVoice(lang: Lang): boolean {
    if (!this.synth) return false;
    return lang === 'en' || !!this.voiceFor('am');
  }

  /** Say it now (cutting off anything still being said). */
  say(text: string, lang: Lang) {
    if (this.muted || !text) return;
    const voice = this.voiceFor(lang);
    if (!this.synth || (lang === 'am' && !voice)) { this.chime(); return; }
    try {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'am' ? 'am-ET' : 'en-US';
      if (voice) u.voice = voice;
      u.rate = this.rate;
      this.synth.speak(u);
    } catch { this.chime(); }
  }

  /** Stop talking. */
  hush() { try { this.synth?.cancel(); } catch { /* nothing to stop */ } }

  /** Two soft notes: "look at the screen". */
  chime() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.audio ??= new Ctx();
      const ctx = this.audio, now = ctx.currentTime;
      for (const [i, f] of [[0, 784], [1, 1047]] as const) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.32);
        o.connect(g).connect(ctx.destination);
        o.start(now + i * 0.16); o.stop(now + i * 0.16 + 0.35);
      }
    } catch { /* audio not allowed yet */ }
  }

  dispose() {
    this.hush();
    this.synth?.removeEventListener?.('voiceschanged', this.onVoices);
    this.audio?.close().catch(() => undefined);
  }

  private voiceFor(lang: Lang): SpeechSynthesisVoice | undefined {
    const want = lang === 'am' ? 'am' : 'en';
    return this.voices.find(v => v.lang?.toLowerCase().startsWith(want));
  }
}
