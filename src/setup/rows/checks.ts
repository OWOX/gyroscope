import { hasPrimaryKey } from '../../model/graph';
import { singleKey } from '../../model/core';
import { pickPrimaryKey } from '../recommend/fixes';
import type { Row, RowState } from '../types';
import { dataMartPage, make, martTitle, openOption, setOption, type Ctx } from './common';

const ASK = 'Ask an admin for access';

/** Data checks on what the settings point at; none until a goal is saved. */
export function checkRows(ctx: Ctx): Row[] {
  const { s } = ctx;
  const goal = s.goal;
  if (!goal) return [];
  const accessible = (id: string) => { const m = ctx.graph.inputs.marts.find((x) => x.id === id); return ctx.byId.has(id) && !!m && m.status === 'PUBLISHED' && m.availableForReporting !== false; };
  const failedOf = (id: string) => ctx.graph.failed.get(id);
  const couldnt = (id: string): { state: RowState; detail?: string } | null => (failedOf(id) !== undefined ? { state: 'error', detail: `Couldn't check: ${failedOf(id)}` } : null);
  const goalNode = ctx.byId.get(goal.martId);
  const rows: Row[] = [];
  const OK = 'OK';
  // the viewer can't open the project goal Data Mart, so the canvas is centered on a context critical number: nothing for them to fix here
  const center = ctx.model && ctx.model.goal.goalMartId !== goal.martId ? ctx.model : null;
  const using = center ? `Using ${center.metrics.find((m) => m.id === center.goal.metricId)?.alias ?? 'a context'} critical number` : null;

  const gAccess = couldnt(goal.martId) ?? (accessible(goal.martId) ? { state: 'done' as RowState } : { state: 'open' as RowState, detail: `${martTitle(ctx, goal.martId)} isn't published or you can't access it` });
  const viaContext = !!using && !accessible(goal.martId);
  rows.push(make(ctx, 'check.goal.access', 'check.goal.access', 'checks', {}, { ...(viaContext ? { state: 'done' as RowState } : gAccess), current: viaContext ? using : gAccess.state === 'done' ? OK : null, options: [openOption('open', ASK, dataMartPage(ctx, goal.martId))] }));

  const key = goalNode ? pickPrimaryKey(goalNode) : null;
  const pkLabel = (k: string | null) => (k ? `Set ${k} as the primary key` : 'Mark a primary key');
  const gPk = couldnt(goal.martId) ?? (goalNode ? (hasPrimaryKey(goalNode.detail) ? { state: 'done' as RowState } : { state: 'open' as RowState, detail: `${goalNode.title} has no primary key` }) : { state: 'open' as RowState, detail: `${martTitle(ctx, goal.martId)} isn't available` });
  rows.push(make(ctx, 'check.goal.pk', 'check.goal.pk', 'checks', {}, { ...(viaContext ? { state: 'done' as RowState } : gPk), current: viaContext ? using : gPk.state === 'done' ? OK : null, options: [openOption('open', pkLabel(key), dataMartPage(ctx, goal.martId))] }));

  for (const id of s.coreClasses) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    const vars = { Class: node.title };
    const k = pickPrimaryKey(node);
    rows.push(make(ctx, 'check.core.pk', `check.core.pk:${id}`, 'checks', vars, {
      state: singleKey(node.detail) ? 'done' : 'open', current: singleKey(node.detail) ? OK : null, group: node.title, detail: singleKey(node.detail) ? undefined : `${node.title} has no single-column primary key`,
      options: [openOption('open', pkLabel(k), dataMartPage(ctx, id))],
    }));
    const linked = ctx.edges.some((e) => (e.from === goal.martId && e.to === id) || (e.from === id && e.to === goal.martId));
    rows.push(make(ctx, 'check.core.toGoal', `check.core.toGoal:${id}`, 'checks', vars, {
      state: linked ? 'done' : 'open', current: linked ? OK : null, group: node.title, detail: linked ? undefined : `${node.title} isn't connected to ${martTitle(ctx, goal.martId)}`,
      options: [openOption('open', `Add a calculated field to ${martTitle(ctx, goal.martId)} that references ${node.title}.${k ?? 'its key'}`, dataMartPage(ctx, goal.martId))],
    }));
  }

  const used = new Set<string>([...s.coreClasses, ...Object.values(s.contexts).flatMap((c) => [c.metric?.martId, c.plan?.martId]), ...Object.values(s.classes).flatMap((c) => c.shown.map((x) => x.martId)), ...Object.values(s.plans).map((p) => p.martId), goal.plan?.martId].filter((x): x is string => !!x));
  used.delete(goal.martId);
  const bad = [...used].filter((id) => !accessible(id));
  const first = bad[0];
  const failedBad = bad.find((id) => failedOf(id) !== undefined);
  rows.push(make(ctx, 'check.access', 'check.access', 'checks', {}, {
    state: failedBad ? 'error' : bad.length ? 'open' : 'done', current: failedBad || bad.length ? null : OK,
    detail: failedBad ? `Couldn't check: ${failedOf(failedBad)}` : bad.length ? `You can't access ${bad.map((id) => martTitle(ctx, id)).join(', ')}` : undefined,
    options: [openOption('open', ASK, dataMartPage(ctx, first))],
  }));
  return rows;
}

/** The AI credential and the on-track margin. */
export function housekeepingRows(ctx: Ctx): Row[] {
  const { s } = ctx;
  // a custom value kept from before the first save still counts as set; the saved value leads so it is the recommended one
  const done = s.updatedAt !== null || s.thresholdPct !== 20;
  const levels = done ? [s.thresholdPct, ...[20, 10, 15, 25, 30].filter((n) => n !== s.thresholdPct)] : [20, 10, 15, 25, 30];
  return [
    make(ctx, 'ai.credential', 'ai.credential', 'housekeeping', {}, {
      state: ctx.hasAi ? 'done' : 'open', current: ctx.hasAi ? 'Connected' : null,
      options: [openOption('open', 'Map an AI credential', `/ui/${ctx.projectId}/plugins`)],
    }),
    make(done ? { ...ctx, ai: { ...ctx.ai, threshold: '' } } : ctx, 'threshold', 'threshold', 'housekeeping', {}, {
      state: done ? 'done' : 'open', current: done ? `${s.thresholdPct}%` : null,
      options: levels.map((n) => setOption(`threshold:${n}`, `${n}%`, (x) => ({ ...x, thresholdPct: n }))),
    }),
  ];
}
