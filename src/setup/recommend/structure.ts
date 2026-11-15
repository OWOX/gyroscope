import type { Edge, Model } from '../../types';
import type { MartNode } from '../../model/graph';
import { inboundCounts, rankCore, singleKey } from '../../model/core';
import { parseRefs } from '../../lib/refs';
import { numericFields, type FieldCand } from './fields';

/** Legacy core ids that are still valid first, then the ranking. */
export function coreCandidates(goalId: string, nodes: MartNode[], edges: Edge[], legacy: string[]): string[] {
  const ranked = rankCore({ goalId, nodes: nodes.map((n) => ({ id: n.id, title: n.title, singleKey: singleKey(n.detail) })), edges });
  return [...legacy.filter((id) => ranked.includes(id)), ...ranked.filter((id) => !legacy.includes(id))];
}

/** As many as are referenced by two or more Data Marts, kept within 3 to 7. */
export function coreDefault(cands: string[], edges: Edge[]): string[] {
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
