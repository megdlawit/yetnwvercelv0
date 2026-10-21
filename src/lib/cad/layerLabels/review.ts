// The admin's review of AI layer labels: order, groups, confirmation and the
// gate on "Create venue". Pure functions over immutable rows, so the panel
// stays simple and the rules are tested on their own.
//
// Rules
//   * Rows are listed lowest confidence first (no confidence = least sure).
//   * Confirming one row (button, or choosing a label) is `individual`;
//     "Confirm group" confirms the pending rows of one label as `group`;
//     "Confirm all" confirms EVERY remaining row as `bulk` — one click. The
//     people importing are venue managers, not architects: what they can
//     judge is the map preview, not "A-GLAZ-CWMG". A row the AI couldn't
//     name ("unknown") takes the rules' suggestion, or is left out
//     ("ignore"), so it shows in the preview instead of blocking.
//     Bulk confirmations are never used as training data.
//   * ignore / walkable / unknown (the service's always_confirm list) are
//     never confirmed by "Confirm group" — those need their own click there.
//   * One row labeled "unknown" can't be confirmed: choose a real label first.
//   * Gate: while the policy says confirm_all_layers, every row must be
//     confirmed; otherwise flagged rows and always-confirm labels must be.
//   * Second opinion: the editor's own rules (classifyLayers) are compared
//     with the AI on every row (withRuleHints). A disagreement flags the row
//     and shows both; the rules' label is pre-selected only when it is the
//     safer start. Pre-selecting never confirms anything, and aiLabel stays
//     what the AI said (it is what gets saved as the AI's answer).

import { ALWAYS_CONFIRM, LABEL_ROOM_TYPE, LABEL_TO_CATEGORY, isLayerLabel, type LayerLabel } from './labels';
import type { Category } from '../types';
import { categoryFromName } from '../classify';

export type ConfirmedVia = 'individual' | 'group' | 'bulk';

export interface LayerSummary {
  name: string;
  total?: number;
  entity_counts: Record<string, number>;
  blocks: string[];
  texts: string[];
}

/** One layer as the labeling service returns it. */
export interface AiLayer {
  name: string;
  label: string;
  confidence: number | null;
  needs_review: boolean;
  must_confirm: boolean;
  /** Who decided: the model, the editor's name rules (model not asked), or an empty layer. Older services: absent. */
  source?: 'model' | 'rules' | 'empty';
  summary: LayerSummary;
}

export interface ReviewPolicy {
  confirm_all_layers: boolean;
  threshold: number;
  always_confirm: string[];
}

export interface ReviewRow {
  name: string;
  aiLabel: LayerLabel;
  confidence: number | null;
  /** Flagged by the service (low/missing confidence or an always-confirm label). */
  flagged: boolean;
  mustConfirm: boolean;
  summary: LayerSummary;
  /** The label the admin currently has (starts as the AI's, or the rules' — see withRuleHints). */
  label: LayerLabel;
  confirmedVia: ConfirmedVia | null;
  /** Who suggested `aiLabel`: the model, the name rules, or nothing on the layer. */
  source: 'model' | 'rules' | 'empty';
  /** What the editor's rules suggest, when they disagree with the AI. */
  ruleLabel?: LayerLabel;
  ruleReason?: string;
}

/** The editor's rule-based suggestion for one layer (from classifyLayers). */
export interface RuleHint { category: Category; confidence: number; reason: string }

/** The AI label closest to each editor category (ignore covers dimension and walkable too). */
export const CATEGORY_TO_LABEL: Record<Category, LayerLabel> = {
  walls: 'wall', doors: 'door', windows: 'window', rooms: 'room', stairs: 'stairs', elevators: 'elevator',
  furniture: 'furniture', trees: 'vegetation', labels: 'text', ignore: 'ignore',
};

/** A rule this sure (a standard layer name, an empty layer) is the better start when the AI disagrees. */
export const TRUSTED_RULE = 0.9;
/** Below this a rule is a weak guess ("mostly circles → trees"): shown, never pre-selected for an unsure AI. */
export const USABLE_RULE = 0.55;
/** Labels the rules have no word for: an unsure AI answer of these is not replaced by a rule. */
const RULES_CANNOT_SAY: ReadonlySet<LayerLabel> = new Set(['restroom', 'walkable', 'dimension']);

export interface LabelGroup {
  label: LayerLabel;
  /** All rows with this label. */
  count: number;
  /** Rows a "Confirm group" would confirm now. */
  pending: number;
  /** A few of those, least confident first, so the admin sees what they confirm. */
  samples: string[];
  /** False for ignore / walkable / unknown: those are confirmed one by one. */
  groupable: boolean;
}

export const DEFAULT_POLICY: ReviewPolicy = { confirm_all_layers: true, threshold: 0.7, always_confirm: [...ALWAYS_CONFIRM] };

export function rowsFromResult(layers: AiLayer[]): ReviewRow[] {
  return sortRows(layers.map(l => {
    const valid = isLayerLabel(l.label);
    const label: LayerLabel = valid ? l.label as LayerLabel : 'unknown';
    // As on the service: a label outside the list carries no confidence in anything.
    const confidence = !valid ? 0 : typeof l.confidence === 'number' ? l.confidence : null;
    return {
      name: l.name, aiLabel: label, confidence,
      flagged: l.needs_review || label === 'unknown', mustConfirm: l.must_confirm !== false,
      summary: l.summary, label, confirmedVia: null, source: l.source ?? 'model',
    };
  }));
}

/**
 * Adds the editor's rules as a second opinion. Same category → nothing changes.
 * Different → the row is flagged and carries the rules' label; that label is
 * pre-selected when
 *   * the rule is trusted (a standard name, an empty layer), or
 *   * the AI had no usable answer (unknown, or below the threshold) and the rule
 *     is more than a weak guess — unless the AI said something the rules can't
 *     (restroom, walkable, dimension), or
 *   * the drawing has (almost) everything on this one layer: then it is the
 *     plan's line work, and anything but the rules' "walls" would drop or
 *     distort the whole plan.
 * An empty layer the AI couldn't name starts as "ignore" (it adds nothing to
 * the map either way; "ignore" still needs its own confirmation).
 */
export function withRuleHints(rows: ReviewRow[], hints: Record<string, RuleHint>, threshold: number,
                              singleLayer: string | null = null): ReviewRow[] {
  return rows.map(r => {
    if (r.summary.total === 0 && r.label === 'unknown') return { ...r, label: 'ignore' as LayerLabel, ruleReason: 'Layer is empty' };
    const hint = hints[r.name];
    if (!hint) return r;
    const rule = CATEGORY_TO_LABEL[hint.category];
    const aiCategory = r.aiLabel === 'unknown' ? null : LABEL_TO_CATEGORY[r.aiLabel];
    if (aiCategory === hint.category) return r;
    const aiUnsure = r.aiLabel === 'unknown' || r.confidence === null || r.confidence < threshold;
    const preselect = hint.confidence >= TRUSTED_RULE
      || (aiUnsure && hint.confidence >= USABLE_RULE && !RULES_CANNOT_SAY.has(r.aiLabel))
      || r.name === singleLayer;
    return { ...r, flagged: true, ruleLabel: rule, ruleReason: hint.reason, label: preselect ? rule : r.label };
  });
}

/**
 * Name-only hints for layers the editor's reader skipped (it doesn't read layers
 * holding only dimensions or hatching, so classifyLayers never sees "DIM2" or
 * "HACTH"). Hints the editor already has win.
 */
export function withNameHints(names: string[], hints: Record<string, RuleHint>): Record<string, RuleHint> {
  const extra: Record<string, RuleHint> = {};
  for (const name of names) {
    const category = hints[name] ? null : categoryFromName(name);
    if (category) extra[name] = { category, confidence: 0.92, reason: `Name "${name}" matches ${category}` };
  }
  return { ...extra, ...hints };
}

/** The labels the rules are sure enough about that the model needn't be asked (sent with the job). */
export function knownFromHints(hints: Record<string, RuleHint>): Record<string, LayerLabel> {
  return Object.fromEntries(Object.entries(hints)
    .filter(([, h]) => h.confidence >= TRUSTED_RULE)
    .map(([name, h]) => [name, CATEGORY_TO_LABEL[h.category]]));
}

/** Lowest confidence first; rows without one first of all; then by name. */
export function sortRows(rows: ReviewRow[]): ReviewRow[] {
  const key = (r: ReviewRow) => (r.confidence === null ? -1 : r.confidence);
  return [...rows].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
}

export const alwaysConfirm = (label: LayerLabel, policy: ReviewPolicy) =>
  policy.always_confirm.includes(label) || label === 'unknown';

export const canConfirm = (row: ReviewRow) => row.label !== 'unknown';

const update = (rows: ReviewRow[], pick: (r: ReviewRow) => boolean, change: (r: ReviewRow) => Partial<ReviewRow>) =>
  rows.map(r => (pick(r) ? { ...r, ...change(r) } : r));

/**
 * The admin actively picked a different label for one layer: that is an
 * individual confirmation ("unknown" stays unconfirmed). Picking the label the
 * row already has changes nothing — showing, focusing or pre-filling the
 * dropdown never confirms anything; the Confirm button does.
 */
export function setLabel(rows: ReviewRow[], name: string, label: LayerLabel): ReviewRow[] {
  return update(rows, r => r.name === name && r.label !== label, () => ({ label, confirmedVia: label === 'unknown' ? null : 'individual' }));
}

export function confirmRow(rows: ReviewRow[], name: string): ReviewRow[] {
  return update(rows, r => r.name === name && canConfirm(r), () => ({ confirmedVia: 'individual' }));
}

export function unconfirmRow(rows: ReviewRow[], name: string): ReviewRow[] {
  return update(rows, r => r.name === name, () => ({ confirmedVia: null }));
}

const groupEligible = (r: ReviewRow, policy: ReviewPolicy) => !r.confirmedVia && canConfirm(r) && !alwaysConfirm(r.label, policy);

export function groups(rows: ReviewRow[], policy: ReviewPolicy): LabelGroup[] {
  const by = new Map<LayerLabel, ReviewRow[]>();
  for (const r of rows) by.set(r.label, [...(by.get(r.label) ?? []), r]);
  return [...by.entries()]
    .map(([label, rs]) => {
      const pending = sortRows(rs.filter(r => groupEligible(r, policy)));
      return { label, count: rs.length, pending: pending.length, samples: pending.slice(0, 3).map(r => r.name), groupable: !alwaysConfirm(label, policy) };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function confirmGroup(rows: ReviewRow[], label: LayerLabel, policy: ReviewPolicy): ReviewRow[] {
  return update(rows, r => r.label === label && groupEligible(r, policy), () => ({ confirmedVia: 'group' }));
}

export function confirmBulk(rows: ReviewRow[], _policy?: ReviewPolicy): ReviewRow[] {
  return update(rows, r => !r.confirmedVia, r => (r.label === 'unknown'
    ? { label: r.ruleLabel ?? 'ignore', confirmedVia: 'bulk', ruleReason: r.ruleLabel ? r.ruleReason : 'Not identified — left out' }
    : { confirmedVia: 'bulk' }));
}

/** How many rows "Confirm all" would confirm (every unconfirmed row). */
export const bulkCount = (rows: ReviewRow[], _policy?: ReviewPolicy) => rows.filter(r => !r.confirmedVia).length;

/** Rows "Confirm all" would leave out because nobody could name them (no AI label, no rule). */
export const bulkLeftOut = (rows: ReviewRow[]) => rows.filter(r => !r.confirmedVia && r.label === 'unknown' && !r.ruleLabel).length;

/** Rows still blocking "Create venue". */
export function blocking(rows: ReviewRow[], policy: ReviewPolicy): ReviewRow[] {
  return rows.filter(r =>
    r.label === 'unknown'
    || (!r.confirmedVia && (policy.confirm_all_layers || r.mustConfirm || alwaysConfirm(r.label, policy))));
}

export function matches(row: ReviewRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.label, ...row.summary.blocks, ...row.summary.texts].some(s => s.toLowerCase().includes(q));
}

/**
 * What the AI review may contribute to an import: the reviewed mapping, room
 * types and the rows to save — and ONLY when the review finished ('done').
 * In every other state (off, waiting, failed, unavailable, skipped to the
 * rule-based suggestions) it is null: no AI label reaches the venue and
 * nothing is written to layer_labels.
 */
export function aiContribution(phase: string, rows: ReviewRow[]) {
  if (phase !== 'done' || rows.length === 0) return null;
  return { ...toMapping(rows), rows };
}

/** The import's layer mapping and room types from the reviewed labels (unknown rows are left out). */
export function toMapping(rows: ReviewRow[]): { mapping: Record<string, Category>; roomTypes: Record<string, string> } {
  const mapping: Record<string, Category> = {};
  const roomTypes: Record<string, string> = {};
  for (const r of rows) {
    if (r.label === 'unknown') continue;
    mapping[r.name] = LABEL_TO_CATEGORY[r.label];
    const type = LABEL_ROOM_TYPE[r.label];
    if (type) roomTypes[r.name] = type;
  }
  return { mapping, roomTypes };
}
