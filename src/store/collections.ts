import { toDay } from '../lib/dates';
import { DEFAULT_SETTINGS, PRESET_LABELS, type CompareChoice, type ComparePreset, type DateWindow, type RangeChoice, type Preset, type ViewSettings, type WeekStart } from '../types';

export interface CollectionsLike {
  collections<T>(name: string): {
    get(id: string): Promise<{ document: T } | null>;
    /** `parentId` is required by collections bound to an entity, such as `mart-cache`. */
    put(id: string, doc: T, options?: { parentId?: string }): Promise<unknown>;
  };
}

const readProject = async (ctx: CollectionsLike): Promise<Record<string, unknown>> => {
  const doc = (await ctx.collections<unknown>('settings').get('project'))?.document;
  return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
};

/** The member's own view settings; a stored default preset counts only from a 0.4 doc (`v: 4`), so a 0.3 choice is ignored once. */
export async function loadViewSettings(ctx: CollectionsLike): Promise<ViewSettings> {
  const raw = await readProject(ctx);
  const own = (await ctx.collections<Record<string, unknown>>('preferences').get('defaults').catch(() => null))?.document;
  const mine = own && typeof own === 'object' ? own : {};
  const d = DEFAULT_SETTINGS;
  const pick = <T,>(ok: (v: unknown) => v is T, key: string, fallback: T): T => (ok(mine[key]) ? mine[key] : ok(raw[key]) ? raw[key] : fallback);
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
  const isWeek = (v: unknown): v is WeekStart => v === 'monday' || v === 'sunday';
  return {
    defaultPreset: mine.v === 4 ? presetOf(mine.defaultPreset) : null,
    comparisonDefault: pick(isBool, 'comparisonDefault', d.comparisonDefault),
    weekStart: pick(isWeek, 'weekStart', d.weekStart),
  };
}
export async function saveViewSettings(ctx: CollectionsLike, s: ViewSettings): Promise<void> {
  await ctx.collections<unknown>('preferences').put('defaults', { ...s, v: 4 });
}
const COMPARE_PRESETS: readonly ComparePreset[] = ['previous_period', 'preceding_days', 'year_before'];
const isDay = (v: unknown): v is Day => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && toDay(Date.parse(`${v}T00:00:00Z`)) === v;
function windowOf(v: unknown): DateWindow | null {
  const w = (v ?? {}) as Record<string, unknown>;
  return isDay(w.from) && isDay(w.to) && w.from <= w.to ? { from: w.from, to: w.to } : null;
}
/** The `this_*` presets used to mean actual-to-date; that is what the `*td` ids mean now, so a saved choice keeps its numbers. */
const RENAMED: Record<string, Preset> = { this_year: 'ytd', this_quarter: 'qtd', this_month: 'mtd', this_week: 'wtd' };
const presetOf = (v: unknown): Preset | null => {
  if (typeof v !== 'string') return null;
  if (Object.hasOwn(RENAMED, v)) return RENAMED[v]!;
  return Object.hasOwn(PRESET_LABELS, v) ? (v as Preset) : null;
};
function rangeOf(v: unknown): RangeChoice | null {
  const r = (v ?? {}) as Record<string, unknown>;
  if (r.kind === 'preset') { const preset = presetOf(r.preset); return preset ? { kind: 'preset', preset } : null; }
  const window = r.kind === 'custom' ? windowOf(r.window) : null;
  return window ? { kind: 'custom', window } : null;
}
function compareOf(v: unknown): CompareChoice | null {
  const c = (v ?? {}) as Record<string, unknown>;
  if (c.kind === 'off') return { kind: 'off' };
  if (c.kind === 'preset') return COMPARE_PRESETS.includes(c.preset as ComparePreset) ? { kind: 'preset', preset: c.preset as ComparePreset } : null;
  const window = c.kind === 'custom' ? windowOf(c.window) : null;
  return window ? { kind: 'custom', window } : null;
}

export interface Preferences { range: RangeChoice | null; compare: CompareChoice | null }
/** The member's last applied choice; a part that fails validation is null. A doc without `v: 4` (written by 0.3) is ignored. */
export async function loadPreferences(ctx: CollectionsLike): Promise<Preferences | null> {
  const raw = (await ctx.collections<Record<string, unknown>>('preferences').get('current'))?.document;
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).v !== 4) return null;
  const range = rangeOf(raw.range);
  const compare = compareOf(raw.compare);
  return range || compare ? { range, compare } : null;
}
export const savePreferences = async (ctx: CollectionsLike, p: { range: RangeChoice | null; compare: CompareChoice }): Promise<void> => { await ctx.collections<unknown>('preferences').put('current', { ...p, v: 4 }); };

export function memoryCollections(): CollectionsLike & { parentOf(name: string, id: string): string | undefined } {
  const store = new Map<string, Map<string, unknown>>();
  const parents = new Map<string, string>();
  return {
    collections<T>(name: string) {
      const col = store.get(name) ?? new Map<string, unknown>();
      store.set(name, col);
      return {
        get: async (id: string) => (col.has(id) ? { document: col.get(id) as T } : null),
        put: async (id: string, doc: T, options?: { parentId?: string }) => {
          col.set(id, doc);
          if (options?.parentId) parents.set(`${name}/${id}`, options.parentId);
        },
      };
    },
    parentOf: (name, id) => parents.get(`${name}/${id}`),
  };
}
