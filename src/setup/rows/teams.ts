import type { ProjectSettingsV5 } from '../../types';
import { criticalCandidates, dateCandidates, kindFor } from '../recommend/fields';
import { countsContext } from '../../model/derive';
import { teamDrafts } from '../recommend/structure';
import type { Multi, MultiItem, Row } from '../types';
import { contextPage, descriptionRow, make, metricRow, openOption, planRow, type Ctx, type Plain } from './common';

/** The teams block: whether contexts exist, then a number, plan and description line per context. */
export function teamRows(ctx: Ctx): Row[] {
  const { s } = ctx;
  const all = ctx.graph.inputs.contexts;
  // a context that doesn't move the needle has no rows
  const contexts = all.filter((c) => countsContext(s, c.id, all));
  const drafts = teamDrafts(ctx.nodes);
  const options: Plain[] = [];
  if (drafts.length) options.push({ id: 'teams', label: `Create ${drafts.map((d) => d.name).join(', ')} and add their Data Marts`, action: { kind: 'teams', teams: drafts } });
  options.push(openOption('open', 'Create contexts in OWOX', `/ui/${ctx.projectId}/project-settings/contexts`));
  const items: MultiItem[] = all.map((c) => ({ path: c.id, label: c.name, icon: 'context', recommended: false, link: contextPage(ctx, c.id), linkLabel: c.name, ...(c.description ? { description: c.description } : {}) }));
  const ids = new Set(all.map((c) => c.id));
  // every context checked is "null", so a context added later joins by itself
  const multi: Multi = {
    items, checked: contexts.map((c) => c.id),
    action: (paths) => (paths.every((p) => ids.has(p)) ? { kind: 'set', next: (x) => ({ ...x, needleContexts: all.every((c) => paths.includes(c.id)) ? null : all.filter((c) => paths.includes(c.id)).map((c) => c.id) }) } : undefined),
  };
  const rows = [make(ctx, 'teams.exist', 'teams.exist', 'teams', {}, { state: contexts.length >= 2 ? 'done' : 'open', current: contexts.length ? contexts.map((c) => c.name).join(', ') : null, ...(contexts.length ? { currentList: contexts.map((c) => c.name) } : {}), ...(items.length ? { multi } : {}), options })];

  for (const c of contexts) {
    const vars = { Team: c.name };
    const from = rows.length;
    const gi = { groupLink: contextPage(ctx, c.id), ...(c.description ? { groupDescription: c.description } : {}) };
    const mine = ctx.nodes.filter((n) => n.contexts.some((x) => x.id === c.id));
    const pool = mine.length ? mine : ctx.nodes;
    const saved = s.contexts[c.id] ?? { metric: null, plan: null };
    const write = (f: (cur: typeof saved) => typeof saved) => (x: ProjectSettingsV5): ProjectSettingsV5 => ({ ...x, contexts: { ...x.contexts, [c.id]: f(x.contexts[c.id] ?? { metric: null, plan: null }) } });
    const cand = criticalCandidates(pool, ctx.edges, { description: c.description, source: c.id });
    const top = cand[0];
    rows.push(metricRow(ctx, 'team.metric', `team:${c.id}.metric`, 'teams', vars, c.name, cand, saved.metric && { martId: saved.metric.martId, field: saved.metric.measure.field },
      (x, f) => write((cur) => ({ ...cur, metric: { martId: f.martId, ...kindFor(f), alias: f.label, dateField: dateCandidates(ctx.byId.get(f.martId)!)[0]?.path ?? null } }))(x)));
    const kind = saved.metric?.kind ?? (top ? kindFor(top).kind : 'flow');
    rows.push(planRow(ctx, 'team.plan', `team:${c.id}.plan`, 'teams', vars, c.name, pool, saved.metric?.martId ?? top?.martId, kind, saved.plan, (x, p) => write((cur) => ({ ...cur, plan: p }))(x), { description: c.description, source: c.id }, saved.metric ? { martId: saved.metric.martId, field: saved.metric.measure.field } : top && { martId: top.martId, field: top.path }));
    const m = saved.metric ?? (top ? { martId: top.martId, alias: top.label, measure: { field: top.path } } : null);
    rows.push(descriptionRow(ctx, 'team.description', `team:${c.id}.description`, 'teams', vars, c.name, c.id, c.description, { contextId: c.id }, m && { alias: m.alias, martId: m.martId, path: m.measure.field, plan: saved.plan }));
    for (let i = from; i < rows.length; i++) rows[i] = { ...rows[i]!, ...gi };
  }
  return rows;
}
