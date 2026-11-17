import { coreChoices, coreDefault } from '../recommend/structure';
import type { Multi, MultiItem, Row, RowState } from '../types';
import { countsContext } from '../../model/derive';
import { make, martPage, martTitle, openOption, dataMartPage, type Ctx, type Plain } from './common';

const MAX = 7;

/** The core entities row: a checkbox per suggested class, the recommended ones marked; the chosen ones list first. */
export function coreRows(ctx: Ctx): Row[] {
  const { s } = ctx;
  const { inputs } = ctx.graph;
  const text = { projectDescription: inputs.projectDescription, contexts: inputs.contexts.filter((c) => countsContext(s, c.id, inputs.contexts)) };
  const { order: cand, ranked, mentioned } = ctx.goalId ? coreChoices(ctx.goalId, ctx.nodes, ctx.edges, ctx.legacyCore, text) : { order: [], ranked: [], mentioned: [] };
  const chosen = s.coreClasses;
  const def = new Set(coreDefault(ranked, ctx.edges, mentioned));
  const gone = chosen.filter((id) => !ctx.byId.has(id));
  const failed = gone.find((id) => ctx.graph.failed.has(id));
  const title = (id: string) => martTitle(ctx, id);
  const order = [...chosen, ...cand.filter((id) => !chosen.includes(id))];
  const desc = (id: string) => ctx.graph.inputs.marts.find((m) => m.id === id)?.description;
  const items: MultiItem[] = order.map((id) => ({ path: id, label: title(id), martId: id, icon: 'mart', recommended: def.has(id), link: martPage(ctx, id), linkLabel: title(id), ...(desc(id) ? { description: desc(id)! } : {}) }));
  const multi: Multi = {
    max: MAX, items, checked: chosen,
    action: (paths) => (paths.length <= MAX && paths.every((p) => order.includes(p)) ? { kind: 'set', next: (x) => ({ ...x, coreClasses: order.filter((id) => paths.includes(id)) }) } : undefined),
  };
  const options: Plain[] = items.length ? [] : [openOption('none', "Not available yet: add relationships from the critical number's Data Mart", ctx.goalId ? martPage(ctx, ctx.goalId) : dataMartPage(ctx))];
  const enough = chosen.length >= 3 || (cand.length > 0 && (ranked.length ? ranked : cand).every((id) => chosen.includes(id)));
  const unreachable = ctx.goalId ? chosen.filter((id) => ctx.byId.has(id) && !cand.includes(id)) : [];
  const state: RowState = failed ? 'error' : gone.length || unreachable.length ? 'broken' : enough ? 'done' : 'open';
  const detail = failed ? `Couldn't check: ${ctx.graph.failed.get(failed)}` : gone.length ? `${title(gone[0]!)} isn't available any more` : unreachable.length ? `${title(unreachable[0]!)} has no relationship with the critical number's Data Mart` : undefined;
  return [make(ctx, 'core.classes', 'core.classes', 'goal', {}, { state, detail, current: chosen.length ? chosen.map(title).join(', ') : null, ...(items.length ? { multi } : {}), options })];
}
