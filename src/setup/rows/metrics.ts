import type { MetricChoice, MetricFormat, ProjectSettingsV5 } from '../../types';
import { metricId, ratioMetricId } from '../../model/derive';
import { dateCandidates, formatFor, kindFor, type FieldCand } from '../recommend/fields';
import { keyFor, ratioPairs, shownFor } from '../recommend/structure';
import type { Row, RowState } from '../types';
import { dismiss, fieldCheck, fieldLabel, make, martPage, martTitle, planRow, setOption, type Ctx, type Plain } from './common';

const FORMATS: Record<MetricFormat, string> = { number: 'Number', percent: 'Percent', currency: 'Money' };

/** Per class: headline number, card numbers, and a plan and format per shown number; goal and core classes first. */
export function metricRows(ctx: Ctx): Row[] {
  const { s, model } = ctx;
  if (!model) return [];
  const rank = (id: string) => (id === model.goal.classId ? 0 : s.coreClasses.includes(id) ? 1 : 2);
  const classes = model.classes.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.id) - rank(b.c.id) || a.i - b.i).map((x) => x.c);
  const rows: Row[] = [];
  for (const cl of classes) {
    const node = ctx.byId.get(cl.id);
    if (!node) continue;
    const vars = { Class: cl.title };
    const saved = s.classes[cl.id];
    const important = rank(cl.id) < 2;
    const write = (f: (cur: { keyMetricId: string | null; shown: MetricChoice[] }) => { keyMetricId: string | null; shown: MetricChoice[] }) => (x: ProjectSettingsV5): ProjectSettingsV5 => ({ ...x, classes: { ...x.classes, [cl.id]: f(x.classes[cl.id] ?? { keyMetricId: null, shown: [] }) } });

    const rec = keyFor(cl.id, model);
    const alias = (id: string) => model.metrics.find((m) => m.id === id)?.alias ?? id;
    const labelOf = (id: string) => { const m = model.metrics.find((x) => x.id === id); return m ? (m.isUniqueCount || m.ratio ? m.alias : fieldLabel(martTitle(ctx, m.martId), m.alias)) : id; };
    const keys = [...(rec ? [rec] : []), ...cl.metricIds.filter((id) => id !== rec)];
    const stored = saved?.keyMetricId ?? null;
    const keyState: RowState = stored ? (cl.metricIds.includes(stored) ? 'done' : 'broken') : 'open';
    rows.push(make(ctx, 'class.key', `class:${cl.id}.key`, 'metrics', vars, {
      group: cl.title, groupId: cl.id,
      state: keyState, detail: keyState === 'broken' ? `${alias(stored!)} isn't on ${cl.title} any more` : undefined,
      current: stored && keyState === 'done' ? labelOf(stored) : null, severity: important ? 'warning' : 'notice',
      options: keys.map((id) => { const m = model.metrics.find((x) => x.id === id); return setOption(`metric:${id}`, labelOf(id), write((cur) => ({ ...cur, keyMetricId: id })), m && martPage(ctx, m.martId, m.measure.field), m && labelOf(id)); }),
    }));

    const choice = (c: FieldCand): MetricChoice => ({ martId: c.martId, ...kindFor(c), dateField: dateCandidates(node)[0]?.path ?? null, alias: c.label });
    const recShown = shownFor(cl.id, model, node);
    const picks: Plain[] = [];
    const fieldLink = (c: FieldCand) => [martPage(ctx, c.martId, c.path), fieldLabel(c.martTitle, c.label)] as const;
    // the combined pick points at its one field, or at the class's Data Mart when it covers several
    if (recShown.length) picks.push(setOption(`shown:${recShown.map((c) => c.path).join(',')}`, recShown.map((c) => fieldLabel(c.martTitle, c.label)).join(', '), write((cur) => ({ ...cur, shown: recShown.map(choice) })), ...(recShown.length === 1 ? fieldLink(recShown[0]!) : [martPage(ctx, cl.id), cl.title] as const)));
    for (const c of recShown) picks.push(setOption(`shown:${c.path}`, fieldLabel(c.martTitle, c.label), write((cur) => ({ ...cur, shown: [choice(c)] })), ...fieldLink(c)));
    picks.push({ ...setOption('shown:none', 'No extra numbers', (x) => dismiss(write((cur) => ({ ...cur, shown: [] }))(x), `class:${cl.id}.shown`)), declines: true });
    const shown = saved?.shown ?? [];
    const bad = shown.map((c) => ({ c, chk: fieldCheck(ctx, c.martId, [c.measure.field]) })).find((x) => x.chk.state !== 'done');
    rows.push(make(ctx, 'class.shown', `class:${cl.id}.shown`, 'metrics', vars, {
      group: cl.title, groupId: cl.id,
      state: bad ? bad.chk.state : shown.length ? 'done' : 'open', detail: bad?.chk.detail,
      current: shown.length ? shown.map((c) => fieldLabel(martTitle(ctx, c.martId), c.alias)).join(', ') : null, options: picks,
    }));

    for (const c of shown) {
      const mid = metricId(c.martId, c.measure);
      const mvars = { ...vars, Metric: c.alias };
      rows.push({ ...planRow(ctx, 'metric.plan', `metric:${mid}.plan`, 'metrics', mvars, cl.title, ctx.nodes, c.martId, c.kind, s.plans[mid] ?? null,
        (x, p) => { const plans = { ...x.plans }; if (p) plans[mid] = p; else delete plans[mid]; return { ...x, plans }; }), groupId: cl.id });
      const fr = formatFor(c.alias);
      const fmt = s.formats[mid];
      const order = (Object.keys(FORMATS) as MetricFormat[]).sort((a, b) => +(b === fr.format) - +(a === fr.format));
      rows.push(make(ctx, 'metric.format', `metric:${mid}.format`, 'metrics', mvars, {
      group: cl.title, groupId: cl.id,
        state: fmt ? 'done' : 'open', current: fmt ? FORMATS[fmt.format] : null,
        options: order.map((f) => setOption(`format:${f}`, FORMATS[f], (x) => ({ ...x, formats: { ...x.formats, [mid]: { format: f, currency: f === 'currency' ? fr.currency : null } } }))),
      }));
    }
  }
  return rows;
}

/** One row per connected pair with no calculated metric between them, plus the ratios already saved. */
export function ratioRows(ctx: Ctx): Row[] {
  const { s, model } = ctx;
  if (!model) return [];
  const alias = (id: string) => model.metrics.find((m) => m.id === id)?.alias ?? id;
  const rows: Row[] = [];
  for (const r of s.ratios) {
    const id = r.id;
    const live = model.metrics.some((m) => m.id === r.id);
    const numMart = model.metrics.find((m) => m.id === r.numerator)?.martId;
    // a ratio points at its numerator's Data Mart only
    const link = numMart && martPage(ctx, numMart);
    const linkLabel = numMart && martTitle(ctx, numMart);
    const keep = { ...setOption('ratio:keep', 'Keep this ratio', (x) => x, link, linkLabel), keep: true };
    const remove = setOption('ratio:remove', 'Remove this ratio', (x) => ({ ...x, ratios: x.ratios.filter((y) => y.id !== r.id) }), link, linkLabel);
    const row = make(ctx, 'ratio', id, 'ratios', { A: alias(r.numerator), B: alias(r.denominator) }, {
      state: live ? 'done' : 'broken', detail: live ? undefined : "This ratio's numbers aren't on the canvas any more", current: r.name,
      options: live ? [keep, remove] : [remove, keep],
    });
    rows.push({ ...row, dismissable: false });
  }
  for (const p of ratioPairs(model, ctx.nodes)) {
    const id = ratioMetricId(p.numerator, p.denominator);
    if (s.ratios.some((r) => r.id === id)) continue;
    const skipped = s.dismissed.includes(id);
    const numMart = model.metrics.find((m) => m.id === p.numerator)?.martId;
    const row = make(ctx, 'ratio', id, 'ratios', { A: alias(p.numerator), B: alias(p.denominator) }, {
      state: skipped ? 'done' : 'open', current: skipped ? 'Skipped' : null,
      options: [
        setOption('ratio:add', `Add ${p.name}`, (x) => ({ ...x, ratios: [...x.ratios.filter((y) => y.id !== id), { id, name: p.name, numerator: p.numerator, denominator: p.denominator, format: 'number' }] }), numMart && martPage(ctx, numMart), numMart && martTitle(ctx, numMart)),
        { ...setOption('ratio:skip', 'Skip this ratio', (x) => dismiss(x, id)), declines: true },
      ],
    });
    // a skipped pair stays listed so it can be changed back
    rows.push(skipped ? { ...row, dismissable: false, dismissed: true } : row);
  }
  return rows;
}
