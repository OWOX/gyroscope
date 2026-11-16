import type { Blocked, ClassNode, Measure, MetricChoice, MetricDef, Model, PlanDef, ProjectSettingsV5 } from '../types';
import { allFieldPaths, DATE_TYPES, flattenFields, type Blendable, type MartDetail } from '../owox/sources';
import { hashString } from '../lib/hash';
import { buildEdges, classDepths, hasPrimaryKey } from './graph';
import { inboundCounts } from './core';
import type { MartNode } from './graph';
import type { Graph } from './graph-load';

export type { Graph } from './graph-load';
export type Derived = { ok: true; model: Model } | { ok: false; blocked: Blocked };

export const metricId = (martId: string, m: Measure) => `${martId}:${m.field}:${m.fn ?? 'calc'}`;
export const ratioMetricId = (numerator: string, denominator: string) => `ratio:${numerator}/${denominator}`;

const isDate = (type: string) => DATE_TYPES.has(type.toUpperCase());

/** The Data Mart's unique-count metric over its first key field, or null without one. */
export function uniqueCountMetric(detail: MartDetail, blendable: Blendable): MetricDef | null {
  const key = blendable.mainUniqueCountKeyFields[0];
  if (key === undefined) return null;
  const flat = flattenFields(detail.fields);
  const dates = flat.filter((x) => isDate(x.field.type));
  const dateField = (dates.find((x) => x.field.isPrimaryKey) ?? dates.find((x) => /creat|date|time/i.test(x.field.name)) ?? dates[0])?.path ?? null;
  const measure: Measure = { field: key, fn: 'COUNT_DISTINCT' };
  return { id: metricId(detail.id, measure), martId: detail.id, alias: detail.title, measure, kind: 'flow', role: 'unique', source: 'schema', isUniqueCount: true, calculated: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, dateField };
}

/** The drawn Data Marts' shape: field paths, types, keys, formulas and join sources, so a schema change moves the hash. */
const schemaFingerprint = (nodes: MartNode[]) => nodes.map((n) => [
  n.id,
  flattenFields(n.detail.fields).map((x) => [x.path, x.field.type, !!x.field.isPrimaryKey, x.field.calculated?.formula ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  n.blendable.availableSources.map((x) => [x.aliasPath, x.dataMartId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

const blocked = (code: Blocked['code'], detail: string): Derived => ({ ok: false, blocked: { code, detail, mismatches: [] } });

type Center = MetricChoice & { plan: PlanDef | null; source: string };
export const NO_ACCESSIBLE_GOAL = "To use Gyroscope, you need access to a Data Mart with a critical number: the project's or a context's. Ask a project admin for access.";

/** The context critical number the viewer can open whose Data Mart has the fewest references to the (hidden) project goal; ties keep the settings order. */
function nearestContextGoal(s: ProjectSettingsV5, g: Graph, byId: Map<string, MartNode>, visible: ReadonlySet<string>): Center | null {
  const goalMart = s.goal!.martId;
  const edges = buildEdges(g.nodes, visible, goalMart);
  const hops = (from: string): number => {
    const seen = new Map([[from, 0]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.from !== cur || seen.has(e.to)) continue;
        seen.set(e.to, seen.get(cur)! + 1);
        if (e.to === goalMart) return seen.get(e.to)!;
        queue.push(e.to);
      }
    }
    return Infinity;
  };
  const ok = (c: MetricChoice) => {
    const n = byId.get(c.martId);
    return !!n && c.dateField !== null && allFieldPaths(n.detail.fields).has(c.measure.field) && allFieldPaths(n.detail.fields).has(c.dateField) && hasPrimaryKey(n.detail);
  };
  const ranked = Object.entries(s.contexts)
    .filter(([id]) => countsContext(s, id))
    .flatMap(([id, c]) => (c.metric && ok(c.metric) ? [{ goal: { ...c.metric, plan: c.plan, source: id } as Center, hops: hops(c.metric.martId) }] : []))
    .sort((a, b) => a.hops - b.hops);
  return ranked[0]?.goal ?? null;
}

/** Whether a context moves the needle: every one does until a set is saved. */
export const countsContext = (s: ProjectSettingsV5, id: string): boolean => !s.needleContexts || s.needleContexts.includes(id);

/** The canvas model the settings describe, over the schemas as they are now. Never calls the AI; equal inputs give an equal model. */
export function deriveModel(s: ProjectSettingsV5, g: Graph): Derived {
  if (!s.goal) return blocked('NO_GOAL', 'The Business Critical Number is not set.');
  if (!s.goal.dateField) return blocked('GOAL_NO_DATE', 'The Critical Number Date is not set.');
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const has = (d: MartDetail, path: string | null) => path === null || allFieldPaths(d.fields).has(path);
  const readFailure = g.failed.get(s.goal.martId);
  if (!byId.has(s.goal.martId) && readFailure !== undefined) return blocked('GOAL_NO_ACCESS', `Couldn't check ${g.inputs.marts.find((m) => m.id === s.goal!.martId)?.title ?? 'the goal Data Mart'}: ${readFailure}`);
  const visible = new Set(g.inputs.marts.map((m) => m.id));
  let goal: Center;
  if (byId.has(s.goal.martId)) {
    goal = { ...s.goal, source: 'project' };
    const goalNode = byId.get(goal.martId)!;
    if (!has(goalNode.detail, goal.measure.field)) return blocked('GOAL_FIELD_NOT_FOUND', `${goal.measure.field} isn't in ${goalNode.title} any more.`);
    if (!has(goalNode.detail, goal.dateField)) return blocked('GOAL_NO_DATE', `${goal.dateField} isn't in ${goalNode.title} any more.`);
    if (!hasPrimaryKey(goalNode.detail)) return blocked('GOAL_NO_PRIMARY_KEY', `${goalNode.title} has no primary key.`);
  } else {
    // the viewer can't open the project's goal: the nearest context critical number they can open is the center
    const found = nearestContextGoal(s, g, byId, visible);
    if (!found) return blocked('NO_ACCESSIBLE_GOAL', NO_ACCESSIBLE_GOAL);
    goal = found;
  }
  const edges = buildEdges(g.nodes, visible);
  const classable = new Set(g.nodes.filter((n) => hasPrimaryKey(n.detail)).map((n) => n.id));
  const depths = classDepths(goal.martId, edges, classable);
  const core = new Set(s.coreClasses.filter((id) => classable.has(id)));
  const touchesGoal = (id: string) => edges.some((e) => (e.from === goal.martId && e.to === id) || (e.from === id && e.to === goal.martId));
  for (const id of core) if (!depths.has(id) && touchesGoal(id)) depths.set(id, 1);

  const fmt = (id: string) => s.formats[id] ?? { format: 'number' as const, currency: null };
  const usable = (c: MetricChoice) => { const n = byId.get(c.martId); return !!n && has(n.detail, c.measure.field) && has(n.detail, c.dateField); };
  const def = (c: MetricChoice, role: MetricDef['role'], source: string, plan: MetricDef['plan']): MetricDef => {
    const id = metricId(c.martId, c.measure);
    const field = flattenFields(byId.get(c.martId)!.detail.fields).find((x) => x.path === c.measure.field)?.field;
    return { id, martId: c.martId, alias: c.alias, measure: c.measure, kind: c.kind, dateField: c.dateField, role, source, isUniqueCount: false, plan, shown: true, ...fmt(id), forecast: null, calculated: !!field?.calculated, description: field?.description ?? null };
  };

  const metrics = new Map<string, MetricDef>();
  const add = (m: MetricDef) => { if (!metrics.has(m.id)) metrics.set(m.id, m); };
  const goalDef = def(goal, 'critical', goal.source, goal.plan);
  add(goalDef);
  for (const [ctxId, c] of Object.entries(s.contexts)) if (countsContext(s, ctxId) && c.metric && usable(c.metric) && depths.has(c.metric.martId)) add(def(c.metric, 'critical', ctxId, c.plan));

  const drafts: { n: MartNode; depth: number; own: string[]; uc: MetricDef | null }[] = [];
  for (const n of g.nodes) {
    const depth = depths.get(n.id);
    if (depth === undefined) continue;
    const own: string[] = [];
    if (n.id === goal.martId) own.push(goalDef.id);
    for (const m of metrics.values()) if (m.martId === n.id && !own.includes(m.id)) own.push(m.id);
    const uc = uniqueCountMetric(n.detail, n.blendable);
    if (uc) { add({ ...uc, ...fmt(uc.id) }); if (!own.includes(uc.id)) own.push(uc.id); }
    for (const c of s.classes[n.id]?.shown ?? []) {
      if (c.martId !== n.id || !usable(c)) continue;
      const m = def(c, 'leading', 'project', s.plans[metricId(c.martId, c.measure)] ?? null);
      add(m);
      if (!own.includes(m.id)) own.push(m.id);
    }
    drafts.push({ n, depth, own, uc });
  }

  // ratios join once every plain metric exists; one whose side is missing or is itself a ratio is dropped before keys are chosen
  const ratioIds = new Set(s.ratios.map((r) => r.id));
  for (const r of s.ratios) {
    if (metrics.has(r.id) || ratioIds.has(r.numerator) || ratioIds.has(r.denominator) || !metrics.has(r.denominator)) continue;
    const num = metrics.get(r.numerator);
    const d = num && drafts.find((x) => x.n.id === num.martId);
    if (!num || !d) continue;
    add({ ...num, id: r.id, alias: r.name, role: 'leading', source: 'project', isUniqueCount: false, plan: null, forecast: null, format: r.format, currency: r.format === 'currency' ? num.currency : null, calculated: false, description: null, ratio: { numerator: r.numerator, denominator: r.denominator } });
    d.own.push(r.id);
  }

  const classes: ClassNode[] = [];
  for (const { n, depth, own, uc } of drafts) {
    const chosen = s.classes[n.id]?.keyMetricId;
    const key = chosen && own.includes(chosen) ? chosen : n.id === goal.martId ? goalDef.id : uc && own.includes(uc.id) ? uc.id : own[0] ?? null;
    const ordered = key ? [key, ...own.filter((id) => id !== key)] : own;
    classes.push({ id: n.id, martId: n.id, title: n.title, contexts: n.contexts.filter((x) => countsContext(s, x.id)), depth, keyMetricId: key, metricIds: ordered, shown: true, core: core.has(n.id), inbound: 0 });
  }
  const inbound = inboundCounts(edges);
  for (const c of classes) c.inbound = inbound.get(c.id) ?? 0;
  classes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const kept = new Set(classes.flatMap((c) => c.metricIds));
  for (const r of s.ratios) if (kept.has(r.id)) kept.add(r.denominator);
  const { updatedAt, updatedBy, ...content } = s;
  return {
    ok: true,
    model: {
      version: 3,
      inputHash: hashString(JSON.stringify([content, schemaFingerprint(g.nodes.filter((n) => depths.has(n.id)))])),
      builtAt: updatedAt ?? 'never',
      builtBy: updatedBy ?? '',
      editedAt: null, editedBy: null,
      goal: { classId: goal.martId, metricId: goalDef.id, goalMartId: goal.martId, viaFallback: false },
      classes,
      edges: edges.filter((e) => depths.has(e.from) && depths.has(e.to)).map((e) => ({ from: e.from, to: e.to, fields: e.fields })),
      metrics: [...metrics.values()].filter((m) => kept.has(m.id)).sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
}
