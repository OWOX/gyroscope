import { coreCandidates, coreDefault } from '../recommend/structure';
import type { Row, RowState } from '../types';
import { make, martTitle, openOption, setOption, dataMartPage, type Ctx, type Plain } from './common';

/** The core entities row: the recommended set, then add or remove one at a time. */
export function coreRows(ctx: Ctx): Row[] {
  const { s } = ctx;
  const cand = ctx.goalId ? coreCandidates(ctx.goalId, ctx.nodes, ctx.edges, ctx.legacyCore) : [];
  const chosen = s.coreClasses;
  const def = coreDefault(cand, ctx.edges);
  const gone = chosen.filter((id) => !ctx.byId.has(id));
  const failed = gone.find((id) => ctx.graph.failed.has(id));
  const set = (ids: string[]) => (x: typeof s) => ({ ...x, coreClasses: ids });
  const title = (id: string) => martTitle(ctx, id);
  const options: Plain[] = [];
  if (def.length) options.push(setOption(`core:${def.join(',')}`, def.map(title).join(', '), set(def)));
  for (const id of cand) if (!chosen.includes(id) && chosen.length < 7) options.push(setOption(`core:+${id}`, `Add ${title(id)}`, set([...chosen, id])));
  for (const id of chosen) options.push(setOption(`core:-${id}`, `Remove ${title(id)}`, set(chosen.filter((x) => x !== id))));
  if (!options.length) options.push(openOption('none', 'Not available yet: add Data Marts that other Data Marts reference', dataMartPage(ctx)));
  const enough = chosen.length >= 3 || (cand.length > 0 && cand.every((id) => chosen.includes(id)));
  const state: RowState = failed ? 'error' : gone.length ? 'broken' : enough ? 'done' : 'open';
  const detail = failed ? `Couldn't check: ${ctx.graph.failed.get(failed)}` : gone.length ? `${title(gone[0]!)} isn't available any more` : undefined;
  return [make(ctx, 'core.classes', 'core.classes', 'core', {}, { state, detail, current: chosen.length ? chosen.map(title).join(', ') : null, options })];
}
