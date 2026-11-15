import type { Edge, MetricKind, PlanDef, ProjectSettingsV5 } from '../../types';
import type { Graph } from '../../model/derive';
import type { Model } from '../../types';
import { buildEdges, type MartNode } from '../../model/graph';
import { allFieldPaths, flattenFields } from '../../owox/sources';
import { criticalCandidates, dateCandidates, kindFor, planCandidates, shapeFor, type FieldCand } from '../recommend/fields';
import { repick } from '../recommend/fixes';
import { COPY, fill } from '../catalog';
import { criticalRow, findMetricRows, isFieldLink } from '../tables';
import type { Action, BlockId, Option, Row, RowState, Scope, Severity } from '../types';

export type Goal = NonNullable<ProjectSettingsV5['goal']>;
export type Plain = Omit<Option, 'recommended'>;
export interface RowsInput {
  settings: ProjectSettingsV5; graph: Graph; model: Model | null;  // model is null while blocked
  legacyCore: string[]; projectId: string; hasAi: boolean;
  ai: Record<string, string>;            // row id to option id, from SuggestionsDoc.items
  aiPending: ReadonlySet<string>;        // row ids whose AI pick is still running
}
/** Everything a row builder needs, computed once. */
export interface Ctx extends RowsInput {
  s: ProjectSettingsV5; nodes: MartNode[]; byId: Map<string, MartNode>; edges: Edge[];
  /** The goal Data Mart, or the top critical candidate's while the goal is not set. */
  goalId: string | null;
  /** What the goal would be if the person accepted the top critical number. */
  defaultGoal: Goal | null;
}

const set = (next: (s: ProjectSettingsV5) => ProjectSettingsV5): Action => ({ kind: 'set', next });
export const dismiss = (s: ProjectSettingsV5, id: string): ProjectSettingsV5 => (s.dismissed.includes(id) ? s : { ...s, dismissed: [...s.dismissed, id] });
/** The OWOX page of a Data Mart, or of one of its fields. */
export const martPage = (ctx: Ctx, martId: string, field?: string) => `/ui/${ctx.projectId}/data-marts/${encodeURIComponent(martId)}/data-setup${field === undefined ? '' : `?field=${encodeURIComponent(field)}`}`;
export const dataMartPage = (ctx: Ctx, id?: string) => (id ? martPage(ctx, id) : `/ui/${ctx.projectId}/data-marts`);

export function buildCtx(input: RowsInput): Ctx {
  const nodes = input.graph.nodes;
  const edges = buildEdges(nodes, new Set(input.graph.inputs.marts.map((m) => m.id)));
  const top = criticalCandidates(nodes, edges, { description: input.graph.inputs.projectDescription, source: 'project' })[0];
  const topNode = top && nodes.find((n) => n.id === top.martId);
  const defaultGoal: Goal | null = top && topNode
    ? { martId: top.martId, ...kindFor(top), dateField: dateCandidates(topNode)[0]?.path ?? null, alias: top.label, plan: null }
    : null;
  return { ...input, s: input.settings, nodes, byId: new Map(nodes.map((n) => [n.id, n])), edges, goalId: input.settings.goal?.martId ?? defaultGoal?.martId ?? null, defaultGoal };
}

export const martTitle = (ctx: Ctx, id: string) => ctx.byId.get(id)?.title ?? ctx.graph.inputs.marts.find((m) => m.id === id)?.title ?? 'a Data Mart you can no longer see';
/** "{Data Mart title} · {field}", as OWOX writes a field mention. */
export const fieldLabel = (martTitle: string, field: string) => `${martTitle} · ${field}`;
/** The same label for a field of a Data Mart. */
export function fieldText(ctx: Ctx, martId: string, path: string): string {
  const f = flattenFields(ctx.byId.get(martId)?.detail.fields ?? []).find((x) => x.path === path)?.field;
  return fieldLabel(martTitle(ctx, martId), f?.alias || f?.name || path);
}
/** Applies a change to the goal, starting from the recommended goal when none is saved; no goal to start from leaves the settings as they are. */
export const updGoal = (ctx: Ctx, f: (g: Goal) => Goal) => (s: ProjectSettingsV5): ProjectSettingsV5 => {
  const g = s.goal ?? ctx.defaultGoal;
  return g ? { ...s, goal: f(g) } : s;
};

/** Whether a saved reference still resolves: error when its schema failed to load, broken when it is gone. */
export function fieldCheck(ctx: Ctx, martId: string, paths: (string | null)[]): { state: RowState; detail?: string } {
  const failed = ctx.graph.failed.get(martId);
  if (failed !== undefined) return { state: 'error', detail: `Couldn't check: ${failed}` };
  const node = ctx.byId.get(martId);
  if (!node) return { state: 'broken', detail: `${paths.find((p) => p) ?? 'The field'} isn't in ${martTitle(ctx, martId)} any more` };
  const have = allFieldPaths(node.detail.fields);
  const gone = paths.find((p) => p !== null && !have.has(p));
  return gone === undefined ? { state: 'done' } : { state: 'broken', detail: `${gone} isn't in ${node.title} any more` };
}

export const noneOption = (ctx: Ctx, label = 'Not available yet: add a Data Mart with a number field'): Option => ({ id: 'none', label, recommended: true, action: { kind: 'open', path: dataMartPage(ctx) } });

/** Marks exactly one option recommended: the AI's pick when it names a real option, else the first. */
export function recommend(ctx: Ctx, id: string, options: Plain[], none?: string): { options: Option[] } {
  const seen = new Set<string>();
  const uniq = options.filter((o) => !seen.has(o.id) && !!seen.add(o.id));
  if (!uniq.length) return { options: [noneOption(ctx, none)] };
  const want = ctx.ai[id];
  const pick = uniq.some((o) => o.id === want) ? want : uniq[0]!.id;
  return { options: uniq.map((o) => ({ ...o, recommended: o.id === pick })) };
}

/** A row from its catalog key; `options` come first-is-recommended and are normalised here. */
export function make(ctx: Ctx, key: string, id: string, block: BlockId, vars: Record<string, string>, rest: { state: RowState; current: string | null; options: Plain[]; detail?: string; group?: string; groupId?: string; severity?: Severity; none?: string }): Row {
  const c = COPY[key]!;
  const base = rest.severity ?? c.severity;
  // a broken saved value counts 🟡 unless the row is a blocker
  const severity: Severity = rest.state === 'broken' && base !== 'error' ? 'warning' : base;
  const { options, none, severity: _s, ...more } = rest;
  return { id, block, title: fill(c.title, vars), question: fill(c.question, vars), why: fill(c.why, vars), aiPending: ctx.aiPending.has(id), dismissable: severity === 'notice', ...more, severity, ...recommend(ctx, id, options, none) };
}

export const fieldOption = (ctx: Ctx, c: FieldCand, next: (s: ProjectSettingsV5) => ProjectSettingsV5): Plain => ({ id: `field:${c.martId}:${c.path}`, label: fieldLabel(c.martTitle, c.label), action: set(next), link: martPage(ctx, c.martId, c.path), linkLabel: fieldLabel(c.martTitle, c.label) });
export const setOption = (id: string, label: string, next: (s: ProjectSettingsV5) => ProjectSettingsV5, link?: string, linkLabel?: string): Plain => ({ id, label, action: set(next), ...(link ? { link, linkLabel } : {}) });
export const openOption = (id: string, label: string, path: string): Plain => ({ id, label, action: { kind: 'open', path } });

/** Candidates with the closest field to a gone saved one put first. */
export function withRepick(ctx: Ctx, martId: string, path: string, state: RowState, list: FieldCand[]): FieldCand[] {
  const node = ctx.byId.get(martId);
  const r = state === 'broken' && node ? repick(path, node, (c) => list.some((x) => x.martId === c.martId && x.path === c.path)) : null;
  return r ? [r, ...list] : list;
}

/** A row that picks one numeric field: a critical number of the goal or of a team. */
export function metricRow(ctx: Ctx, key: string, id: string, block: BlockId, vars: Record<string, string>, group: string | undefined, list: FieldCand[], current: { martId: string; field: string } | null, write: (s: ProjectSettingsV5, c: FieldCand) => ProjectSettingsV5): Row {
  const chk = current ? fieldCheck(ctx, current.martId, [current.field]) : { state: 'open' as RowState };
  const options = withRepick(ctx, current?.martId ?? '', current?.field ?? '', chk.state, list).map((c) => fieldOption(ctx, c, (s) => write(s, c)));
  return make(ctx, key, id, block, vars, { ...chk, group, current: current ? fieldText(ctx, current.martId, current.field) : null, options });
}

export const planFor = (ctx: Ctx, c: FieldCand, kind: MetricKind): PlanDef | null => {
  const node = ctx.byId.get(c.martId);
  const dateField = node && dateCandidates(node)[0]?.path;
  return dateField ? { martId: c.martId, measure: { field: c.path, fn: 'SUM' }, dateField, shape: shapeFor(null, kind) } : null;
};

/** A row that picks a plan field, or "No plan yet", which dismisses the row. */
export function planRow(ctx: Ctx, key: string, id: string, block: BlockId, vars: Record<string, string>, group: string | undefined, nodes: MartNode[], prefer: string | undefined, kind: MetricKind, current: PlanDef | null, write: (s: ProjectSettingsV5, plan: PlanDef | null) => ProjectSettingsV5): Row {
  const chk = current ? fieldCheck(ctx, current.martId, [current.measure.field, current.dateField]) : { state: 'open' as RowState };
  const all = planCandidates(nodes, prefer).filter((c) => planFor(ctx, c, kind));
  const list = current ? withRepick(ctx, current.martId, current.measure.field, chk.state, all) : all;
  const options: Plain[] = [
    ...list.flatMap((c) => { const p = planFor(ctx, c, kind); return p ? [fieldOption(ctx, c, (s) => write(s, p))] : []; }),
    { ...setOption('none', 'No plan yet', (s) => dismiss(write(s, null), id)), declines: true },
  ];
  return make(ctx, key, id, block, vars, { ...chk, group, current: current ? fieldText(ctx, current.martId, current.measure.field) : null, options });
}

/** The one-row Metrics table that names a number, with its plan when there is one. */
// text placed in a table cell or a link label: Markdown punctuation escaped, line breaks flattened
const esc = (s: string) => s.replace(/[\\|[\]()]/g, '\\$&').replace(/\s*[\r\n]+\s*/g, ' ');
export function metricsTable(ctx: Ctx, role: string, alias: string, martId: string, path: string, plan: PlanDef | null): string {
  const link = (text: string, m: string, f: string) => `[${esc(text)}](${martPage(ctx, m, f)})`;
  const planCell = plan ? link(fieldText(ctx, plan.martId, plan.measure.field), plan.martId, plan.measure.field) : '';
  return `| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| ${esc(role)} | ${esc(alias)} | ${planCell} | ${link(fieldLabel(martTitle(ctx, martId), alias), martId, path)} |`;
}

/** A row that asks to add the number to a description; done when the description already links the same Data Mart field. */
export function descriptionRow(ctx: Ctx, key: string, id: string, block: BlockId, vars: Record<string, string>, group: string | undefined, source: 'project' | string, description: string | null, scope: Scope, metric: { alias: string; martId: string; path: string; plan: PlanDef | null } | null): Row {
  if (!metric) return make(ctx, key, id, block, vars, { state: 'open', current: null, group, options: [] });
  const named = criticalRow(findMetricRows(description, source))?.fact.some((l) => isFieldLink(l) && l.martId === metric.martId.toLowerCase() && l.field === metric.path) ?? false;
  const text = metricsTable(ctx, 'Critical number', metric.alias, metric.martId, metric.path, metric.plan);
  return make(ctx, key, id, block, vars, { state: named ? 'done' : 'open', current: named ? 'Named in the description' : null, group, options: [{ id: 'append', label: 'Add this line to the description', action: { kind: 'append', scope, text } }] });
}
