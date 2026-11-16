import type { CollectionsLike } from './collections';
import type { Measure, MetricChoice, MetricFormat, MetricKind, PlanDef, PlanShape, ProjectSettingsV5, RatioSetting } from '../types';

export const EMPTY_SETUP: ProjectSettingsV5 = {
  v: 5, goal: null, coreClasses: [], needleContexts: null, contexts: {}, classes: {}, plans: {}, formats: {}, ratios: [],
  thresholdPct: 20, dismissed: [], updatedAt: null, updatedBy: null,
};

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const FNS = ['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX'];
const FORMATS: MetricFormat[] = ['number', 'percent', 'currency'];
const SHAPES: PlanShape[] = ['daily', 'cumulative', 'level'];
const measureOf = (v: unknown): Measure | null => {
  const m = obj(v);
  return m && str(m.field) && (m.fn === null || FNS.includes(m.fn as string)) ? { field: m.field, fn: m.fn as Measure['fn'] } : null;
};
const choiceOf = (v: unknown): MetricChoice | null => {
  const c = obj(v); const measure = measureOf(c?.measure);
  if (!c || !str(c.martId) || !measure || !(c.kind === 'flow' || c.kind === 'level')) return null;
  return { martId: c.martId, measure, dateField: str(c.dateField) ? c.dateField : null, kind: c.kind as MetricKind, alias: str(c.alias) ? c.alias : measure.field };
};
const planOf = (v: unknown): PlanDef | null => {
  const p = obj(v); const measure = measureOf(p?.measure);
  return p && str(p.martId) && measure && str(p.dateField) && SHAPES.includes(p.shape as PlanShape) ? { martId: p.martId, measure, dateField: p.dateField, shape: p.shape as PlanShape } : null;
};
const record = <T,>(v: unknown, each: (x: unknown) => T | null): Record<string, T> =>
  Object.fromEntries(Object.entries(obj(v) ?? {}).flatMap(([k, x]) => { const r = each(x); return r === null ? [] : [[k, r]]; }));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : []);
const threshold = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(1, v)) : EMPTY_SETUP.thresholdPct);

/** A stored doc as v5 settings; a doc from before v5 keeps only its threshold. */
export function readSetup(raw: unknown): ProjectSettingsV5 {
  const r = obj(raw) ?? {};
  if (r.v !== 5) return { ...EMPTY_SETUP, thresholdPct: threshold(r.thresholdPct) };
  const goalChoice = choiceOf(r.goal);
  const ratioOf = (v: unknown): RatioSetting | null => {
    const x = obj(v);
    return x && str(x.id) && str(x.name) && str(x.numerator) && str(x.denominator) ? { id: x.id, name: x.name, numerator: x.numerator, denominator: x.denominator, format: FORMATS.includes(x.format as MetricFormat) ? (x.format as MetricFormat) : 'number' } : null;
  };
  return {
    v: 5,
    goal: goalChoice ? { ...goalChoice, plan: planOf(obj(r.goal)!.plan) } : null,
    coreClasses: strings(r.coreClasses).slice(0, 7),
    needleContexts: Array.isArray(r.needleContexts) ? strings(r.needleContexts) : null,
    contexts: record(r.contexts, (x) => { const c = obj(x); return c ? { metric: choiceOf(c.metric), plan: planOf(c.plan) } : null; }),
    classes: record(r.classes, (x) => { const c = obj(x); return c ? { keyMetricId: str(c.keyMetricId) ? c.keyMetricId : null, shown: (Array.isArray(c.shown) ? c.shown : []).map(choiceOf).filter((m): m is MetricChoice => !!m) } : null; }),
    plans: record(r.plans, planOf),
    formats: record(r.formats, (x) => { const f = obj(x); return f && FORMATS.includes(f.format as MetricFormat) ? { format: f.format as MetricFormat, currency: str(f.currency) ? f.currency : null } : null; }),
    ratios: (Array.isArray(r.ratios) ? r.ratios : []).map(ratioOf).filter((x): x is RatioSetting => !!x),
    thresholdPct: threshold(r.thresholdPct),
    dismissed: strings(r.dismissed),
    updatedAt: str(r.updatedAt) ? r.updatedAt : null,
    updatedBy: str(r.updatedBy) ? r.updatedBy : null,
  };
}

/** The core Data Mart ids a 0.4 doc chose; they come back as recommendations, never as settings. */
export const legacyCore = (raw: unknown): string[] =>
  (Array.isArray(obj(raw)?.coreClasses) ? (obj(raw)!.coreClasses as unknown[]) : []).flatMap((e) => (str(obj(e)?.martId) ? [obj(e)!.martId as string] : []));

const readRaw = async (ctx: CollectionsLike): Promise<Raw> => obj((await ctx.collections<unknown>('settings').get('project'))?.document) ?? {};

/** The stored settings, plus the core ids a 0.4 doc held. */
export async function loadSetup(ctx: CollectionsLike): Promise<{ settings: ProjectSettingsV5; legacyCore: string[] }> {
  const raw = await readRaw(ctx);
  return { settings: readSetup(raw), legacyCore: raw.v === 5 ? [] : legacyCore(raw) };
}

export class SettingsConflict extends Error {
  constructor(public by: string | null, public at: string | null) {
    super('Setup changed since it was loaded');
    this.name = 'SettingsConflict';
  }
}

/** Writes `next` only when the stored doc still has `base`'s updatedAt; keys the settings don't own stay. */
export async function saveSetup(ctx: CollectionsLike, base: ProjectSettingsV5, next: ProjectSettingsV5, by: string, now: Date): Promise<ProjectSettingsV5> {
  const raw = await readRaw(ctx);
  const stored = readSetup(raw);
  if (stored.updatedAt !== base.updatedAt) throw new SettingsConflict(stored.updatedBy, stored.updatedAt);
  const saved: ProjectSettingsV5 = { ...next, v: 5, updatedAt: now.toISOString(), updatedBy: by };
  const { industry: _i, coreClasses: _c, ...kept } = raw;
  await ctx.collections<unknown>('settings').put('project', { ...kept, ...saved });
  return saved;
}

export interface SuggestionsDoc { inputHash: string; at: string; items: Record<string, string> }

/** The stored AI picks, or null when there are none. */
export async function loadSuggestions(ctx: CollectionsLike): Promise<SuggestionsDoc | null> {
  const d = obj((await ctx.collections<unknown>('suggestions').get('current'))?.document);
  return d && str(d.inputHash) && str(d.at) ? { inputHash: d.inputHash, at: d.at, items: record(d.items, (x) => (str(x) ? x : null)) } : null;
}

/** Adds one AI pick; a doc for another hash is replaced. */
export async function saveSuggestion(ctx: CollectionsLike, inputHash: string, rowId: string, optionId: string, now: Date): Promise<void> {
  const cur = await loadSuggestions(ctx);
  const items = cur && cur.inputHash === inputHash ? cur.items : {};
  await ctx.collections<SuggestionsDoc>('suggestions').put('current', { inputHash, at: now.toISOString(), items: { ...items, [rowId]: optionId } });
}
