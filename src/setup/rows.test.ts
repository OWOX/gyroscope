import { describe } from 'vitest';
import { buildRows, type RowsInput } from './rows';
import { EMPTY_SETUP } from '../store/settings';
import { deriveModel, type Graph } from '../model/derive';
import type { MartNode } from '../model/graph';
import type { ProjectSettingsV5 } from '../types';

const f = (name: string, type: string, over: object = {}) => ({ name, type, isPrimaryKey: false, ...over });
const node = (id: string, fields: object[], key?: string): MartNode => ({ id, title: id[0]!.toUpperCase() + id.slice(1), contexts: [], detail: { id, title: id, fields: fields as never }, blendable: { availableSources: [], mainUniqueCountKeyFields: key ? [key] : [] } });
const orders = node('orders', [f('order_id', 'STRING', { isPrimaryKey: true }), f('date', 'DATE'), f('revenue', 'NUMERIC'), f('revenue_plan', 'NUMERIC')], 'order_id');
const graph = (nodes: MartNode[]): Graph => ({ inputs: { projectDescription: null, contexts: [], contextsOk: true, marts: nodes.map((n) => ({ id: n.id, title: n.title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' })) }, nodes, failed: new Map() });
const input = (settings: ProjectSettingsV5, nodes = [orders], over: Partial<RowsInput> = {}): RowsInput => {
  const g = graph(nodes); const d = deriveModel(settings, g);
  return { settings, graph: g, model: d.ok ? d.model : null, legacyCore: [], projectId: 'p1', hasAi: false, ai: {}, aiPending: new Set(), ...over };
};
const goal = { martId: 'orders', measure: { field: 'revenue', fn: 'SUM' as const }, dateField: 'date', kind: 'flow' as const, alias: 'revenue', plan: null };

test('every row has options and exactly one recommended, for a new and a filled project, with and without AI', () => {
  for (const s of [EMPTY_SETUP, { ...EMPTY_SETUP, goal, updatedAt: 't' }])
    for (const hasAi of [false, true])
      for (const r of buildRows(input(s, [orders], { hasAi }))) {
        expect(r.options.length, r.id).toBeGreaterThan(0);
        expect(r.options.filter((o) => o.recommended), r.id).toHaveLength(1);
      }
});

test('a project with no Data Marts still recommends something on every row', () => {
  for (const r of buildRows(input(EMPTY_SETUP, []))) expect(r.options.filter((o) => o.recommended), r.id).toHaveLength(1);
});

test('a new project: the goal rows are open errors recommending revenue and date', () => {
  const rows = buildRows(input(EMPTY_SETUP));
  const metric = rows.find((r) => r.id === 'goal.metric')!;
  expect(metric).toMatchObject({ severity: 'error', state: 'open', current: null, title: 'Business Critical Number', question: 'What is the main business goal?' });
  expect(metric.options.find((o) => o.recommended)!.id).toBe('field:orders:revenue');
  expect(rows.find((r) => r.id === 'goal.date')!.options.find((o) => o.recommended)!.id).toBe('field:orders:date');
});

test('accepting the recommended critical number sets the goal', () => {
  const rows = buildRows(input(EMPTY_SETUP));
  const opt = rows.find((r) => r.id === 'goal.metric')!.options.find((o) => o.recommended)!;
  if (opt.action.kind !== 'set') throw new Error();
  expect(opt.action.next(EMPTY_SETUP).goal).toMatchObject({ martId: 'orders', measure: { field: 'revenue', fn: 'SUM' }, kind: 'flow' });
});

test('an AI pick that names a real option becomes the recommendation; an unknown one is ignored', () => {
  const two = node('orders', [...orders.detail.fields, f('profit', 'NUMERIC')], 'order_id');
  expect(buildRows(input(EMPTY_SETUP, [two], { ai: { 'goal.metric': 'field:orders:profit' } })).find((r) => r.id === 'goal.metric')!.options.find((o) => o.recommended)!.id).toBe('field:orders:profit');
  expect(buildRows(input(EMPTY_SETUP, [two], { ai: { 'goal.metric': 'field:orders:nope' } })).find((r) => r.id === 'goal.metric')!.options.find((o) => o.recommended)!.id).toBe('field:orders:revenue');
});

test('a saved goal field that is gone is broken, recommending the closest field', () => {
  const s = { ...EMPTY_SETUP, goal: { ...goal, measure: { field: 'revenue_old', fn: 'SUM' as const } }, updatedAt: 't' };
  const r = buildRows(input(s)).find((x) => x.id === 'goal.metric')!;
  expect(r.state).toBe('broken');
  expect(r.detail).toBe("revenue_old isn't in Orders any more");
  expect(r.options.find((o) => o.recommended)!.id).toBe('field:orders:revenue');
});

test('a Data Mart whose schema failed to load marks its rows as errors with the reason', () => {
  const g = graph([orders]); g.failed.set('orders', 'HTTP 500');
  const s = { ...EMPTY_SETUP, goal, updatedAt: 't' };
  const r = buildRows({ ...input(s), graph: { ...g, nodes: [] } }).find((x) => x.id === 'goal.metric')!;
  expect(r).toMatchObject({ state: 'error', detail: "Couldn't check: HTTP 500" });
});

test('a dismissed notice is done', () => {
  const s = { ...EMPTY_SETUP, goal, dismissed: ['goal.description'], updatedAt: 't' };
  expect(buildRows(input(s)).find((x) => x.id === 'goal.description')!).toMatchObject({ state: 'done', current: 'Not needed' });
});

// a second Data Mart the first one references, so core, class, ratio and check rows have something to show
const ref = (path: string, field: string) => `{{ref path="${path}" field="${field}"}}`;
const customers = node('customers', [f('customer_id', 'STRING', { isPrimaryKey: true }), f('created_at', 'DATE'), f('ltv', 'NUMERIC'), f('conv_rate', 'NUMERIC')], 'customer_id');
const linked = (): MartNode => ({ ...orders, blendable: { availableSources: [{ aliasPath: 'customers', dataMartId: 'customers', title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['order_id'] }, detail: { ...orders.detail, fields: [...orders.detail.fields, { name: 'cust_ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: `AVG(${ref('customers', 'ltv')})`, level: 'metric' as const } }] as never } });
const filled: ProjectSettingsV5 = { ...EMPTY_SETUP, goal, updatedAt: 't' };
const rec = (r: { options: { id: string; recommended: boolean }[] }) => r.options.find((o) => o.recommended)!.id;
const byId = (rows: ReturnType<typeof buildRows>, id: string) => rows.find((r) => r.id === id)!;

describe('rows over a connected project', () => {
  const rows = (s = filled, over: Partial<RowsInput> = {}) => buildRows(input(s, [linked(), customers], over));

  test('core: the recommended set is a candidate, and choosing every candidate completes the row', () => {
    const r = byId(rows(), 'core.classes');
    expect(r).toMatchObject({ state: 'open', current: null });
    expect(rec(r)).toBe('core:customers');
    expect(byId(rows({ ...filled, coreClasses: ['customers'] }), 'core.classes').state).toBe('done');
  });

  test('class rows exist only with a model; the goal and core classes are warnings, others notices', () => {
    expect(buildRows(input(EMPTY_SETUP, [linked(), customers])).some((r) => r.id.startsWith('class:'))).toBe(false);
    const a = rows();
    expect(byId(a, 'class:orders.key').severity).toBe('warning');
    expect(byId(a, 'class:customers.key').severity).toBe('notice');
    expect(byId(rows({ ...filled, coreClasses: ['customers'] }), 'class:customers.key').severity).toBe('warning');
    expect(byId(a, 'class:orders.key').group).toBe('Orders');
  });

  test('the extra-numbers options link: the combined pick to its one field or to the class, and the link names its destination', () => {
    const r = byId(rows(), 'class:orders.shown');
    const picks = r.options.filter((o) => o.id.startsWith('shown:') && o.id !== 'shown:none');
    expect(picks.length).toBeGreaterThan(0);
    for (const o of picks) expect(o.link, o.id).toMatch(/^\/ui\/p1\/data-marts\/orders\/data-setup/);
    const only = picks.filter((o) => o.link?.includes('?field='));
    expect(only.length).toBeGreaterThan(0);
    for (const o of only) expect(o.linkLabel).toMatch(/^Orders · /);
    const multi = picks.find((o) => o.id.includes(','));
    if (multi) { expect(multi.link).toBe('/ui/p1/data-marts/orders/data-setup'); expect(multi.linkLabel).toBe('Orders'); }
    expect(byId(rows({ ...filled, coreClasses: ['orders'] }), 'core.classes').options.find((o) => o.id === 'core:-orders')!.linkLabel).toBe('Orders');
  });

  test('a saved shown number gets a plan row and a format row recommending percent for a rate', () => {
    const s = { ...filled, classes: { customers: { keyMetricId: null, shown: [{ martId: 'customers', measure: { field: 'conv_rate', fn: 'SUM' as const }, dateField: 'created_at', kind: 'flow' as const, alias: 'conv_rate' }] } } };
    const a = rows(s);
    const fmt = a.find((r) => r.id.endsWith('.format'))!;
    expect(rec(fmt)).toBe('format:percent');
    expect(fmt.title).toBe('conv_rate Format');
    expect(a.some((r) => r.id.endsWith('.plan') && r.id.startsWith('metric:'))).toBe(true);
  });

  test('a ratio key option reads as the ratio name alone', () => {
    const add = rows().find((r) => r.block === 'ratios')!.options.find((o) => o.id === 'ratio:add')!;
    if (add.action.kind !== 'set') throw new Error();
    const next = add.action.next(filled);
    const ratio = next.ratios[0]!;
    const opt = rows(next).filter((r) => r.id.endsWith('.key')).flatMap((r) => r.options).find((o) => o.id === `metric:${ratio.id}`)!;
    expect(opt.label).toBe(ratio.name);
    expect(opt.label).not.toContain(' · ');
  });

  test('a ratio between connected classes is offered, added through settings, and skipping hides it', () => {
    const open = rows().filter((r) => r.block === 'ratios');
    expect(open).toHaveLength(1);
    expect(rec(open[0]!)).toBe('ratio:add');
    const add = open[0]!.options.find((o) => o.id === 'ratio:add')!;
    if (add.action.kind !== 'set') throw new Error();
    const next = add.action.next(filled);
    expect(next.ratios).toHaveLength(1);
    const saved = rows(next).filter((r) => r.block === 'ratios');
    expect(saved[0]).toMatchObject({ state: 'done', dismissable: false });
    expect(rec(saved[0]!)).toBe('ratio:keep');
    expect(rows({ ...filled, dismissed: [open[0]!.id] }).filter((r) => r.block === 'ratios')).toHaveLength(0);
  });

  test('data checks: pass on a healthy goal, and offer the OWOX page when the goal has no key', () => {
    const a = rows();
    expect(byId(a, 'check.goal.pk').state).toBe('done');
    expect(byId(a, 'check.goal.access').state).toBe('done');
    const noKey = { ...orders, detail: { ...orders.detail, fields: orders.detail.fields.map((x) => ({ ...x, isPrimaryKey: false })) as never } };
    const b = buildRows(input(filled, [noKey]));
    const pk = byId(b, 'check.goal.pk');
    expect(pk).toMatchObject({ state: 'open', severity: 'error' });
    expect(pk.options[0]).toMatchObject({ label: 'Set order_id as the primary key', action: { kind: 'open', path: '/ui/p1/data-marts/orders/data-setup' } });
  });

  test('a core class that does not connect to the goal offers a calculated field on the goal', () => {
    const lone = node('stores', [f('store_id', 'STRING', { isPrimaryKey: true })], 'store_id');
    const r = byId(buildRows(input({ ...filled, coreClasses: ['stores'] }, [orders, lone])), 'check.core.toGoal:stores');
    expect(r.state).toBe('open');
    expect(r.options[0]!.label).toBe('Add a calculated field to Orders that references Stores.store_id');
  });

  test('an unpublished Data Mart the settings use fails the access check', () => {
    const g = graph([linked(), customers]);
    g.inputs.marts[1]!.status = 'DRAFT';
    const s = { ...filled, coreClasses: ['customers'] };
    const d = deriveModel(s, g);
    const r = byId(buildRows({ ...input(s), graph: g, model: d.ok ? d.model : null }), 'check.access');
    expect(r).toMatchObject({ state: 'open', severity: 'warning', detail: "You can't access Customers" });
  });
});

test('field labels read "Data Mart · field" in options, current values and links', () => {
  const m = byId(buildRows(input(filled)), 'goal.metric');
  expect(m.current).toBe('Orders · revenue');
  expect(m.options.find((o) => o.id === 'field:orders:revenue')).toMatchObject({ label: 'Orders · revenue', linkLabel: 'Orders · revenue' });
});

test('the description table names the Plan cell as Data Mart · field alias', () => {
  const plan = { martId: 'orders', measure: { field: 'revenue_plan', fn: 'SUM' as const }, dateField: 'date', shape: 'daily' as const };
  const a = byId(buildRows(input({ ...filled, goal: { ...goal, plan } })), 'goal.description').options[0]!.action as { text: string };
  expect(a.text).toContain('[Orders · revenue_plan](/ui/p1/data-marts/orders/data-setup?field=revenue_plan)');
  expect(a.text).toContain('[Orders · revenue](/ui/p1/data-marts/orders/data-setup?field=revenue)');
});

test('a unique count reads as the Data Mart name alone, not "Orders · orders"', () => {
  const r = byId(buildRows(input(filled, [linked(), customers])), 'class:orders.key');
  expect(r.options.some((o) => o.label === 'orders')).toBe(true);
  expect(r.options.some((o) => o.label === 'Orders · orders')).toBe(false);
  expect(byId(buildRows(input({ ...filled, classes: { orders: { keyMetricId: r.options.find((o) => o.label === 'orders')!.id.slice(7), shown: [] } } }, [linked(), customers])), 'class:orders.key').current).toBe('orders');
});

test('a field named like its Data Mart keeps both parts: "revenue · revenue"', () => {
  const mart = { ...node('revenue', [f('id', 'STRING', { isPrimaryKey: true }), f('date', 'DATE'), f('revenue', 'NUMERIC')], 'id'), title: 'revenue' };
  const g = { martId: 'revenue', measure: { field: 'revenue', fn: 'SUM' as const }, dateField: 'date', kind: 'flow' as const, alias: 'revenue', plan: null };
  const m = byId(buildRows(input({ ...EMPTY_SETUP, goal: g, updatedAt: 't' }, [mart])), 'goal.metric');
  expect(m.current).toBe('revenue · revenue');
  expect(m.options.find((o) => o.id === 'field:revenue:revenue')).toMatchObject({ label: 'revenue · revenue', linkLabel: 'revenue · revenue' });
});

describe('rows by block', () => {
  test('goal description is done once the project description links the goal field, and appends the one-row table otherwise', () => {
    const open = byId(buildRows(input(filled)), 'goal.description');
    expect(open.state).toBe('open');
    const opt = open.options[0]!;
    expect(opt.action).toMatchObject({ kind: 'append', scope: 'project', text: '| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | revenue |  | [Orders · revenue](/ui/p1/data-marts/orders/data-setup?field=revenue) |' });
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const g = graph([{ ...orders, id }]);
    g.inputs.projectDescription = `| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | [Revenue](/ui/p1/data-marts/${id}/data-setup?field=revenue) |`;
    const s = { ...filled, goal: { ...goal, martId: id } };
    const d = deriveModel(s, g);
    expect(byId(buildRows({ ...input(s), graph: g, model: d.ok ? d.model : null }), 'goal.description').state).toBe('done');
  });

  test('the plan row ends with "No plan yet", which saves no plan and dismisses the row; the shape row follows a plan', () => {
    const withPlan = node('orders', [...orders.detail.fields], 'order_id');
    const plan = buildRows(input(filled, [withPlan])).find((r) => r.id === 'goal.plan')!;
    expect(rec(plan)).toBe('field:orders:revenue_plan');
    const none = plan.options.at(-1)!;
    expect(none.id).toBe('none');
    if (none.action.kind !== 'set') throw new Error();
    const next = none.action.next(filled);
    expect(next.goal!.plan).toBeNull();
    expect(next.dismissed).toContain('goal.plan');
    expect(buildRows(input(filled, [withPlan])).some((r) => r.id === 'goal.shape')).toBe(false);
    const picked = plan.options[0]!.action;
    if (picked.kind !== 'set') throw new Error();
    const s = picked.next(filled);
    expect(s.goal!.plan).toMatchObject({ martId: 'orders', dateField: 'date', shape: 'daily' });
    expect(rec(byId(buildRows(input(s, [withPlan])), 'goal.shape'))).toBe('shape:daily');
  });

  test('teams: contexts become rows per team, with the team name in the title', () => {
    const g = graph([{ ...orders, contexts: [{ id: 'c1', name: 'Sales' }] }]);
    g.inputs.contexts = [{ id: 'c1', name: 'Sales', description: null }, { id: 'c2', name: 'Marketing', description: null }];
    const a = buildRows({ ...input(filled), graph: g });
    expect(byId(a, 'teams.exist').state).toBe('done');
    expect(byId(a, 'team:c1.metric')).toMatchObject({ title: 'Sales Critical Number', group: 'Sales', severity: 'warning' });
    expect(rec(byId(a, 'team:c1.metric'))).toBe('field:orders:revenue');
    expect(byId(a, 'team:c2.description').options[0]!.action).toMatchObject({ kind: 'append', scope: { contextId: 'c2' } });
  });

  test('a saved threshold recommends itself, a custom one becomes an option', () => {
    const at = (n: number) => byId(buildRows(input({ ...EMPTY_SETUP, thresholdPct: n })), 'threshold');
    expect(rec(at(25))).toBe('threshold:25');
    expect(at(25).options.filter((o) => o.id === 'threshold:25')).toHaveLength(1);
    expect(at(12).options.map((o) => o.id)[0]).toBe('threshold:12');
    expect(at(12).options[0]!.label).toBe('12%');
    expect(rec(at(12))).toBe('threshold:12');
    expect(rec(byId(buildRows(input(EMPTY_SETUP)), 'threshold'))).toBe('threshold:20');
  });

  test('housekeeping: the AI credential and a saved threshold', () => {
    const a = buildRows(input(EMPTY_SETUP));
    expect(byId(a, 'ai.credential')).toMatchObject({ state: 'open', severity: 'warning' });
    expect(byId(a, 'ai.credential').options[0]!.action).toEqual({ kind: 'open', path: '/ui/p1/plugins' });
    expect(buildRows(input(EMPTY_SETUP, [orders], { hasAi: true })).find((r) => r.id === 'ai.credential')!.state).toBe('done');
    const t = byId(a, 'threshold');
    expect(t.options.map((o) => o.id)).toEqual(expect.arrayContaining(['threshold:10', 'threshold:15', 'threshold:20', 'threshold:25', 'threshold:30']));
    expect(rec(t)).toBe('threshold:20');
    expect(t.state).toBe('open');
    expect(byId(buildRows(input(filled)), 'threshold').state).toBe('done');
  });

  test('the AI pick marks the row pending while it runs, and no Data Marts leaves only the open-the-list option on goal rows', () => {
    expect(byId(buildRows(input(EMPTY_SETUP, [orders], { aiPending: new Set(['goal.metric']) })), 'goal.metric').aiPending).toBe(true);
    const none = byId(buildRows(input(EMPTY_SETUP, [])), 'goal.metric').options;
    expect(none).toEqual([{ id: 'none', label: 'Not available yet: add a Data Mart with a number field', recommended: true, action: { kind: 'open', path: '/ui/p1/data-marts' } }]);
  });

  test('a field option links to its field page, a core option to its Data Mart', () => {
    const rows = buildRows(input(EMPTY_SETUP, [orders]));
    expect(byId(rows, 'goal.metric').options.find((o) => o.id === 'field:orders:revenue')!.link).toBe('/ui/p1/data-marts/orders/data-setup?field=revenue');
    expect(byId(rows, 'goal.date').options[0]!.link).toMatch(/^\/ui\/p1\/data-marts\/orders\/data-setup\?field=/);
    expect(byId(buildRows(input({ ...EMPTY_SETUP, coreClasses: ['orders'] }, [orders, customers])), 'core.classes').options.find((o) => o.id === 'core:-orders')!.link).toBe('/ui/p1/data-marts/orders/data-setup');
  });
});

describe('fix round 1', () => {
  const sev = (rows: ReturnType<typeof buildRows>, id: string) => byId(rows, id);

  test('a broken plan row is a non-dismissable warning', () => {
    const g = graph([orders]);
    g.inputs.contexts = [{ id: 'c1', name: 'Sales', description: null }];
    const plan = { martId: 'orders', measure: { field: 'gone_plan', fn: 'SUM' as const }, dateField: 'date', shape: 'daily' as const };
    const s: ProjectSettingsV5 = { ...filled, contexts: { c1: { metric: null, plan } } };
    expect(sev(buildRows({ ...input(s), graph: g }), 'team:c1.plan')).toMatchObject({ state: 'broken', severity: 'warning', dismissable: false });
    const m: ProjectSettingsV5 = { ...filled, classes: { orders: { keyMetricId: null, shown: [{ martId: 'orders', measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', kind: 'flow', alias: 'revenue' }] } }, plans: { 'orders:revenue:SUM': plan } };
    expect(sev(buildRows(input(m)), 'metric:orders:revenue:SUM.plan')).toMatchObject({ state: 'broken', severity: 'warning', dismissable: false });
  });

  test('a gone goal field gives exactly one broken row, and the goal rows stay blockers', () => {
    const s: ProjectSettingsV5 = { ...filled, goal: { ...goal, measure: { field: 'revenue_old', fn: 'SUM' } } };
    const broken = buildRows(input(s)).filter((r) => r.state === 'broken');
    expect(broken.map((r) => r.id)).toEqual(['goal.metric']);
    expect(broken[0]!.severity).toBe('error');
  });

  test('a gone plan field gives one broken row, not the shape row too', () => {
    const plan = { martId: 'orders', measure: { field: 'gone_plan', fn: 'SUM' as const }, dateField: 'date', shape: 'daily' as const };
    const broken = buildRows(input({ ...filled, goal: { ...goal, plan } })).filter((r) => r.state === 'broken');
    expect(broken.map((r) => r.id)).toEqual(['goal.plan']);
  });

  test('the append snippet escapes Markdown in aliases and ids', () => {
    const s: ProjectSettingsV5 = { ...filled, goal: { ...goal, alias: 'Rev | net [x]\nnew' } };
    const a = byId(buildRows(input(s)), 'goal.description').options[0]!.action;
    if (a.kind !== 'append') throw new Error();
    expect(a.text).toContain('| Rev \\| net \\[x\\] new |');
    expect(a.text).toContain('[Orders · Rev \\| net \\[x\\] new](/ui/p1/data-marts/orders/data-setup?field=revenue)');
  });

  test('none labels name the cause', () => {
    const noDate = node('orders', [f('order_id', 'STRING', { isPrimaryKey: true }), f('revenue', 'NUMERIC')], 'order_id');
    expect(byId(buildRows(input({ ...filled, goal: { ...goal, dateField: null } }, [noDate])), 'goal.date').options[0]!.label).toBe('Not available yet: add a date field to Orders');
    const g = graph([]); g.failed.set('orders', 'HTTP 500');
    g.inputs.marts = [{ id: 'orders', title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' }];
    expect(byId(buildRows({ ...input(filled, []), graph: g }), 'goal.date').options[0]!.label).toBe("Not available yet: Orders couldn't be read");
  });

  test('dismissed never closes an error-severity row', () => {
    const a = buildRows(input({ ...EMPTY_SETUP, dismissed: ['goal.metric', 'goal.date', 'goal.plan'] }));
    expect(byId(a, 'goal.metric').state).toBe('open');
    expect(byId(a, 'goal.plan').state).toBe('done');
  });

  test('a saved ratio whose metrics are gone is broken, a warning', () => {
    const s: ProjectSettingsV5 = { ...filled, ratios: [{ id: 'ratio:x/y', name: 'X per Y', numerator: 'x', denominator: 'y', format: 'number' }] };
    expect(byId(buildRows(input(s)), 'ratio:x/y')).toMatchObject({ state: 'broken', severity: 'warning', dismissable: false });
  });
});

describe('review fixes', () => {
  const rows = (s: ProjectSettingsV5, nodes: MartNode[], over: Partial<RowsInput> = {}) => buildRows(input(s, nodes, over));
  const ctxMetric = { martId: 'customers', measure: { field: 'ltv', fn: 'SUM' as const }, dateField: 'created_at', kind: 'flow' as const, alias: 'LTV' };

  test('a broken saved ratio recommends removing it', () => {
    const s = { ...filled, ratios: [{ id: 'gone', name: 'Gone ratio', numerator: 'a', denominator: 'b', format: 'number' as const }] };
    const r = byId(rows(s, [linked(), customers]), 'gone');
    expect(r.state).toBe('broken');
    expect(rec(r)).toBe('ratio:remove');
  });

  test('a passed data check shows OK', () => {
    const a = rows(filled, [linked(), customers]);
    for (const id of ['check.goal.access', 'check.goal.pk', 'check.access']) expect(byId(a, id), id).toMatchObject({ state: 'done', current: 'OK' });
  });

  test('a viewer centered on a context number sees the goal access check as done', () => {
    const g = graph([customers]);
    g.inputs.marts.push({ id: 'orders', title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' });
    const s = { ...filled, contexts: { c1: { metric: ctxMetric, plan: null } } };
    const d = deriveModel(s, g);
    expect(d.ok).toBe(true);
    const r = byId(buildRows({ ...input(s), graph: g, model: d.ok ? d.model : null }), 'check.goal.access');
    expect(r).toMatchObject({ state: 'done', current: 'Using LTV critical number' });
  });

  test('without a saved update a kept custom threshold shows its value; the default stays Not set', () => {
    expect(byId(buildRows(input({ ...EMPTY_SETUP, thresholdPct: 40 })), 'threshold')).toMatchObject({ state: 'done', current: '40%' });
    expect(byId(buildRows(input(EMPTY_SETUP)), 'threshold')).toMatchObject({ state: 'open', current: null });
  });

  test('a Data Mart id is URL-encoded in the page link', () => {
    const odd = node('a b/c', [f('order_id', 'STRING', { isPrimaryKey: true })], 'order_id');
    const r = byId(buildRows(input({ ...filled, goal: { ...goal, martId: 'a b/c' } }, [odd])), 'check.goal.access');
    expect(r.options[0]!.action).toEqual({ kind: 'open', path: '/ui/p1/data-marts/a%20b%2Fc/data-setup' });
  });

  test('the recommended critical number follows the description and prefers a Data Mart that can center the canvas', () => {
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const two = node(id, [f('order_id', 'STRING', { isPrimaryKey: true }), f('date', 'DATE'), f('revenue', 'NUMERIC'), f('profit', 'NUMERIC')], 'order_id');
    const g = graph([two]);
    g.inputs.projectDescription = `| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Profit | | [Profit](/ui/p1/data-marts/${id}/data-setup?field=profit) |`;
    expect(rec(byId(buildRows({ ...input(EMPTY_SETUP, [two]), graph: g }), 'goal.metric'))).toBe(`field:${id}:profit`);
    const loose = node('loose', [f('revenue', 'NUMERIC')]);
    expect(rec(byId(buildRows(input(EMPTY_SETUP, [loose, orders])), 'goal.metric'))).toBe('field:orders:revenue');
  });
});
