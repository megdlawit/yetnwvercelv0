/**
 * VoiceQueue — priority-aware speech orchestration on top of VoiceEngine.
 *
 * The NavigationBrain owns the ONLY VoiceQueue in the app. All TTS goes
 * through this queue so we can:
 *   • Prioritize: route > warning > poi > info.
 *   • Per-priority cooldowns (e.g. POI announcements throttled hard so they
 *     don't drown out turn instructions).
 *   • Deduplicate identical messages within a short window.
 *   • Preempt: a higher-priority message cancels a lower-priority one in flight.
 */

import { VoiceEngine } from '@/lib/VoiceEngine';

export type VoicePriority = 'route' | 'warning' | 'poi' | 'info';

export interface VoiceMessage {
  text: string;
  priority: VoicePriority;
  /** Optional dedup key — defaults to the text. */
  key?: string;
  /** Bypass cooldowns (use sparingly: arrival, hard reroute). */
  immediate?: boolean;
}

const PRIORITY_RANK: Record<VoicePriority, number> = {
  route: 4,
  warning: 3,
  poi: 2,
  info: 1,
};

const COOLDOWN_MS: Record<VoicePriority, number> = {
  route: 2_500,
  warning: 4_000,
  poi: 12_000,
  info: 8_000,
};

const DEDUP_WINDOW_MS = 10_000;

interface InFlight {
  msg: VoiceMessage;
  startedAt: number;
}

export class VoiceQueue {
  private engine: VoiceEngine;
  private enabled = true;
  private lastSpokeAt: Record<VoicePriority, number> = {
    route: 0, warning: 0, poi: 0, info: 0,
  };
  private lastByKey = new Map<string, number>();
  private current: InFlight | null = null;
  private pending: VoiceMessage[] = [];

  constructor(engine?: VoiceEngine) {
    this.engine = engine ?? new VoiceEngine();
    // We control all throttling here; let the underlying engine speak immediately.
    this.engine.setThrottle(0);
  }

  get isEnabled(): boolean { return this.enabled; }
  get isSupported(): boolean { return this.engine.isSupported; }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.engine.setEnabled(on);
    if (!on) {
      this.engine.stop();
      this.current = null;
      this.pending = [];
    }
  }

  /** Push a message; may speak immediately, queue, or drop based on priority. */
  enqueue(msg: VoiceMessage): void {
    if (!this.enabled || !this.engine.isSupported) return;
    const text = msg.text?.trim();
    if (!text) return;

    const now = Date.now();
    const key = msg.key ?? text;

    // Dedup within window unless immediate.
    const lastKey = this.lastByKey.get(key) ?? 0;
    if (!msg.immediate && now - lastKey < DEDUP_WINDOW_MS) return;

    // Cooldown per priority unless immediate.
    if (!msg.immediate && now - this.lastSpokeAt[msg.priority] < COOLDOWN_MS[msg.priority]) {
      // Drop low/info under cooldown; queue route/warning so they fire when freed.
      if (msg.priority === 'route' || msg.priority === 'warning') {
        this.queueIfNotPresent({ ...msg, key });
      }
      return;
    }

    // Preempt in-flight message of strictly lower priority.
    if (this.current && PRIORITY_RANK[msg.priority] > PRIORITY_RANK[this.current.msg.priority]) {
      this.engine.stop();
      this.current = null;
    } else if (this.current) {
      // Same or lower priority while something is speaking → queue route/warning, drop others.
      if (msg.priority === 'route' || msg.priority === 'warning') {
        this.queueIfNotPresent({ ...msg, key });
      }
      return;
    }

    this.speak({ ...msg, key, text });
  }

  /** Stop everything. */
  stop(): void {
    this.engine.stop();
    this.current = null;
    this.pending = [];
  }

  /** Reset cooldowns/dedup (e.g. when a new route starts). */
  reset(): void {
    this.lastByKey.clear();
    this.lastSpokeAt = { route: 0, warning: 0, poi: 0, info: 0 };
    this.pending = [];
    this.current = null;
    this.engine.stop();
  }

  // ── internal ─────────────────────────────────────────────────────

  private queueIfNotPresent(msg: VoiceMessage): void {
    if (this.pending.some(p => (p.key ?? p.text) === (msg.key ?? msg.text))) return;
    this.pending.push(msg);
    // Keep queue sorted by priority desc so the next drain picks the most important.
    this.pending.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  }

  private speak(msg: VoiceMessage): void {
    const now = Date.now();
    this.lastSpokeAt[msg.priority] = now;
    this.lastByKey.set(msg.key ?? msg.text, now);

    if (msg.immediate) {
      this.engine.speakImmediate(msg.text);
    } else {
      this.engine.speak(msg.text);
    }
    this.current = { msg, startedAt: now };
    // Estimate end time by word count (~3 words/sec) and try to drain queue.
    const words = msg.text.split(/\s+/).filter(Boolean).length;
    const estMs = Math.max(800, Math.min(8000, (words / 3) * 1000));
    window.setTimeout(() => {
      if (this.current?.startedAt === now) {
        this.current = null;
        this.drain();
      }
    }, estMs);
  }

  private drain(): void {
    if (!this.enabled || this.current || this.pending.length === 0) return;
    const next = this.pending.shift()!;
    const now = Date.now();
    // Check cooldown again at drain time.
    if (now - this.lastSpokeAt[next.priority] < COOLDOWN_MS[next.priority]) {
      // Still too soon — schedule a retry.
      window.setTimeout(() => this.drain(), 500);
      return;
    }
    this.speak(next);
  }
}
