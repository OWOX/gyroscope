import type { Edge, Model } from '../../types';
import type { MartNode } from '../../model/graph';
import { inboundCounts, singleKey } from '../../model/core';
import { parseRefs } from '../../lib/refs';
import { numericFields, type FieldCand } from './fields';

export interface CoreChoices {
  /** Still-valid saved ids first, then the ranked reachable ones. */
  order: string[];
  /** The reachable ones, ranked. */
  ranked: string[];
  /** The reachable ones the project or a counting context names. */
  mentioned: string[];
}
export interface CoreText { projectDescription: string | null; contexts: { id: string; description: string | null }[] }

/** Data Mart ids linked from Markdown links in a text: the path segment after `/data-marts/`, any host or a relative path, query and hash ignored. */
export function linkedIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
    const seg = /\/data-marts\/([^/?#]+)/.exec(m[1]!)?.[1];
    if (!seg) continue;
    try { ids.add(decodeURIComponent(seg)); } catch { ids.add(seg); }
  }
  return ids;
}

/** Core class choices: single-key Data Marts the goal reaches through joins or calculated fields, linked first, then fewest hops, most referenced, title. */
export function coreChoices(goalId: string, nodes: MartNode[], edges: Edge[], legacy: string[], text: CoreText = { projectDescription: null, contexts: [] }): CoreChoices {
  const hops = new Map<string, number>();
  const bump = (id: string, d: number) => hops.set(id, Math.min(hops.get(id) ?? Infinity, d));
  for (const src of nodes.find((n) => n.id === goalId)?.blendable.availableSources ?? []) {
    if (src.isAccessibleForReporting) bump(src.dataMartId, src.aliasPath.split('.').length);
  }
  for (const e of edges) { if (e.from === goalId) bump(e.to, 1); else if (e.to === goalId) bump(e.from, 1); }
  const inbound = inboundCounts(edges);
  const body = [text.projectDescription, ...text.contexts.map((c) => c.description)].filter(Boolean).join('\n');
  const pool = nodes.filter((n) => n.id !== goalId && singleKey(n.detail) && hops.has(n.id));
  const linked = linkedIds(body);
  const named = new Set(pool.filter((n) => linked.has(n.id)).map((n) => n.id));
  const rank = (a: MartNode, b: MartNode) => Number(named.has(b.id)) - Number(named.has(a.id)) || (hops.get(a.id) ?? Infinity) - (hops.get(b.id) ?? Infinity) || (inbound.get(b.id) ?? 0) - (inbound.get(a.id) ?? 0) || a.title.localeCompare(b.title);
  const ranked = [...pool].sort(rank).map((n) => n.id);
  const all = ranked;
  return { order: [...legacy.filter((id) => all.includes(id)), ...all.filter((id) => !legacy.includes(id))], ranked, mentioned: ranked.filter((id) => named.has(id)) };
}

/** Legacy core ids that are still valid first, then the ranking. */
export const coreCandidates = (goalId: string, nodes: MartNode[], edges: Edge[], legacy: string[], text?: CoreText): string[] => coreChoices(goalId, nodes, edges, legacy, text).order;

/** The mentioned ones (up to 7); with none, as many as are referenced by two or more Data Marts, kept within 3 to 7. */
export function coreDefault(cands: string[], edges: Edge[], mentioned: string[] = []): string[] {
  if (mentioned.length) return mentioned.slice(0, 7);
  const inbound = inboundCounts(edges);
  const strong = cands.filter((id) => (inbound.get(id) ?? 0) >= 2).length;
  return cands.slice(0, Math.min(7, Math.max(3, strong)));
}

/** The class's key metric: one with a plan, else the unique count, else the first SUM, else the first. */
export function keyFor(classId: string, model: Model): string | null {
  const c = model.classes.find((x) => x.id === classId);
  const ms = (c?.metricIds ?? []).flatMap((id) => model.metrics.find((m) => m.id === id) ?? []);
  return (ms.find((m) => m.plan) ?? ms.find((m) => m.isUniqueCount) ?? ms.find((m) => m.measure.fn === 'SUM') ?? ms[0])?.id ?? null;
}

/** Up to 3 numbers for the card besides the key's field: planned fields first, then calculated, then numeric. */
export function shownFor(classId: string, model: Model, node: MartNode): FieldCand[] {
  const keyId = model.classes.find((c) => c.id === classId)?.keyMetricId ?? keyFor(classId, model);
  const keyField = model.metrics.find((m) => m.id === keyId)?.measure.field;
  const planned = new Set(model.metrics.filter((m) => m.martId === classId && m.plan).map((m) => m.measure.field));
  const calc = new Set(node.detail.fields.filter((f) => f.calculated).map((f) => f.name));
  const rank = (f: FieldCand) => (planned.has(f.path) ? 0 : calc.has(f.path) ? 1 : 2);
  return numericFields([node]).filter((f) => f.path !== keyField).map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f).slice(0, 3);
}

export interface RatioPair { numerator: string; denominator: string; name: string }

/** Joined classes with a key metric each, where neither side already has a calculated field built on the other's key field. */
export function ratioPairs(model: Model, nodes: MartNode[]): RatioPair[] {
  const cls = new Map(model.classes.map((c) => [c.id, c]));
  const byId = new Map(model.metrics.map((m) => [m.id, m]));
  const node = new Map(nodes.map((n) => [n.id, n]));
  const references = (fromId: string, toId: string, field: string) => {
    const n = node.get(fromId);
    return (n?.detail.fields ?? []).some((f) => f.calculated && parseRefs(f.calculated.formula).some((r) => r.field === field && n!.blendable.availableSources.find((s) => s.aliasPath === r.path)?.dataMartId === toId));
  };
  const out: RatioPair[] = [];
  for (const e of model.edges) {
    const a = cls.get(e.from), b = cls.get(e.to);
    const num = a?.keyMetricId ? byId.get(a.keyMetricId) : undefined;
    const den = b?.keyMetricId ? byId.get(b.keyMetricId) : undefined;
    if (!num || !den || num.ratio || den.ratio || num.dateField === null || den.dateField === null || references(e.from, e.to, den.measure.field) || references(e.to, e.from, num.measure.field)) continue;
    out.push({ numerator: num.id, denominator: den.id, name: `${num.alias} per ${den.alias}` });
  }
  return out;
}

export interface TeamDraft { name: string; martIds: string[] }
const TEAMS: [string, RegExp][] = [
  ['Marketing', /\bads?\b|campaign|session|traffic|utm|click|impression/i],
  ['Sales', /order|deal|lead|invoice|opportunit/i],
  ['Product', /user|event|feature|install|signup/i],
];

/** Keyword groups over Data Mart titles; a Data Mart joins only the first group it matches, an empty group is dropped. */
export function teamDrafts(nodes: MartNode[]): TeamDraft[] {
  const taken = new Set<string>();
  return TEAMS.map(([name, re]) => {
    const martIds = nodes.filter((n) => !taken.has(n.id) && re.test(n.title)).map((n) => n.id);
    martIds.forEach((id) => taken.add(id));
    return { name, martIds };
  }).filter((t) => t.martIds.length > 0);
}
