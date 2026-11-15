import type { Measure, MetricKind } from '../../types';
import { cands, criticalCandidates, dateCandidates, kindFor, planCandidates, shapeFor } from '../recommend/fields';
import type { Row, RowState } from '../types';
import { descriptionRow, fieldCheck, fieldOption, fieldText, make, martTitle, metricRow, planFor, planRow, setOption, updGoal, withRepick, type Ctx } from './common';

type Fn = NonNullable<Measure['fn']> | 'calc';
const AGG: { fn: Fn; kind: MetricKind; label: string }[] = [
  { fn: 'SUM', kind: 'flow', label: 'Sum, a total over the period' },
  { fn: 'SUM', kind: 'level', label: 'Sum, a level on a day' },
  { fn: 'AVG', kind: 'flow', label: 'Average over the period' },
  { fn: 'COUNT', kind: 'flow', label: 'Count of rows' },
  { fn: 'COUNT_DISTINCT', kind: 'flow', label: 'Count of distinct values' },
  { fn: 'MAX', kind: 'level', label: 'Maximum, a level on a day' },
  { fn: 'calc', kind: 'flow', label: 'As calculated, over the period' },
  { fn: 'calc', kind: 'level', label: 'As calculated, a level on a day' },
];
const SHAPES = { daily: 'Daily amount', cumulative: 'Running total', level: 'Level' } as const;

/** The goal block: critical number, its date, how it adds up, plan, plan shape and the description line. */
export function goalRows(ctx: Ctx): Row[] {
  const { s } = ctx;
  const goal = s.goal;
  const G = goal ?? ctx.defaultGoal;
  const node = G ? ctx.byId.get(G.martId) : undefined;
  const open = { state: 'open' as RowState };
  const goalCheck = goal ? fieldCheck(ctx, goal.martId, [goal.measure.field]) : open;

  const metric = metricRow(ctx, 'goal.metric', 'goal.metric', 'goal', {}, undefined, criticalCandidates(ctx.nodes, ctx.edges, { description: ctx.graph.inputs.projectDescription, source: 'project' }), goal && { martId: goal.martId, field: goal.measure.field }, (x, c) => {
    // the same field again keeps how it adds up and its name
    if (x.goal?.martId === c.martId && x.goal.measure.field === c.path) return x;
    const same = x.goal?.martId === c.martId && x.goal.dateField;
    return { ...x, goal: { martId: c.martId, ...kindFor(c), alias: c.label, dateField: same ? x.goal!.dateField : dateCandidates(ctx.byId.get(c.martId)!)[0]?.path ?? null, plan: x.goal?.martId === c.martId ? x.goal.plan : null } };
  });

  const dates = node ? dateCandidates(node) : [];
  const dateChk = !goal ? open : goal.dateField ? fieldCheck(ctx, goal.martId, [goal.dateField]) : open;
  const date = make(ctx, 'goal.date', 'goal.date', 'goal', {}, {
    ...dateChk, none: !G ? undefined : ctx.graph.failed.has(G.martId) ? `Not available yet: ${martTitle(ctx, G.martId)} couldn't be read` : node ? `Not available yet: add a date field to ${node.title}` : undefined, current: goal?.dateField ? fieldText(ctx, goal.martId, goal.dateField) : null,
    options: (goal?.dateField ? withRepick(ctx, goal.martId, goal.dateField, dateChk.state, dates) : dates).map((c) => fieldOption(ctx, c, updGoal(ctx, (g) => ({ ...g, dateField: c.path })))),
  });

  const field = G && node ? cands(node, () => true).find((c) => c.path === G.measure.field) : undefined;
  const rec = field ? kindFor(field) : null;
  const recId = rec ? `agg:${rec.measure.fn ?? 'calc'}:${rec.kind}` : '';
  const calc = G?.measure.fn === null;
  const aggs = G && node ? AGG.filter((a) => (a.fn === 'calc') === calc).map((a) => ({ ...a, id: `agg:${a.fn}:${a.kind}` })).sort((a, b) => +(b.id === recId) - +(a.id === recId)) : [];
  const aggregation = make(ctx, 'goal.aggregation', 'goal.aggregation', 'goal', {}, {
    ...(goalCheck.state === 'error' ? goalCheck : goal ? { state: 'done' as RowState } : open), current: goal ? AGG.find((a) => a.fn === (goal.measure.fn ?? 'calc') && a.kind === goal.kind)?.label ?? null : null,
    options: aggs.map((a) => setOption(a.id, a.label, updGoal(ctx, (g) => ({ ...g, measure: { field: g.measure.field, fn: a.fn === 'calc' ? null : a.fn }, kind: a.kind })))),
  });

  const plan = planRow(ctx, 'goal.plan', 'goal.plan', 'goal', {}, undefined, ctx.nodes, G?.martId, G?.kind ?? 'flow', goal?.plan ?? null, (x, p) => updGoal(ctx, (g) => ({ ...g, plan: p }))(x), { description: ctx.graph.inputs.projectDescription, source: 'project' });

  const rows = [metric, date, aggregation, plan];
  // the shape only matters once a plan is set; while no goal is saved the page still shows the question
  const firstPlan = planCandidates(ctx.nodes, G?.martId).flatMap((c) => planFor(ctx, c, G?.kind ?? 'flow') ?? [])[0] ?? null;
  const shapePlan = goal ? goal.plan : firstPlan;
  if (shapePlan) {
    const rec = shapeFor(null, G?.kind ?? 'flow');
    const planCheck = goal?.plan ? fieldCheck(ctx, goal.plan.martId, [goal.plan.measure.field, goal.plan.dateField]) : open;
    rows.push(make(ctx, 'goal.shape', 'goal.shape', 'goal', {}, {
      ...(planCheck.state === 'error' ? planCheck : goal?.plan ? { state: 'done' as RowState } : open), current: goal?.plan ? SHAPES[goal.plan.shape] : null,
      options: (Object.keys(SHAPES) as (keyof typeof SHAPES)[]).sort((a, b) => +(b === rec) - +(a === rec)).map((k) => setOption(`shape:${k}`, SHAPES[k], updGoal(ctx, (g) => ({ ...g, plan: { ...(g.plan ?? shapePlan), shape: k } })))),
    }));
  }

  rows.push(descriptionRow(ctx, 'goal.description', 'goal.description', 'goal', {}, undefined, 'project', ctx.graph.inputs.projectDescription, 'project', G && { alias: G.alias, martId: G.martId, path: G.measure.field, plan: goal?.plan ?? null }));
  return rows;
}
