import { deriveModel, metricId, ratioMetricId, type Graph } from './derive';
import { EMPTY_SETUP } from '../store/settings';
import type { MartNode } from './graph';
import type { ProjectSettingsV5 } from '../types';

const field = (name: string, type: string, over: object = {}) => ({ name, type, isPrimaryKey: false, ...over });
const node = (id: string, fields: object[], sources: { aliasPath: string; dataMartId: string }[] = [], key?: string): MartNode => ({
  id, title: id[0]!.toUpperCase() + id.slice(1), contexts: [],
  detail: { id, title: id, fields: fields as never },
  blendable: { availableSources: sources.map((s) => ({ ...s, title: s.dataMartId, isAccessibleForReporting: true })), mainUniqueCountKeyFields: key ? [key] : [] },
});
const orders = node('orders', [
  field('order_id', 'STRING', { isPrimaryKey: true }), field('date', 'DATE'), field('revenue', 'NUMERIC'), field('user_id', 'STRING'),
  field('user_ref', 'STRING', { calculated: { formula: '{{ref path="users" field="user_id"}}' } }),
], [{ aliasPath: 'users', dataMartId: 'users' }], 'order_id');
const users = node('users', [field('user_id', 'STRING', { isPrimaryKey: true }), field('signup', 'DATE'), field('ltv', 'NUMERIC')], [], 'user_id');
const graph = (nodes: MartNode[] = [orders, users]): Graph => ({
  inputs: { projectDescription: null, contexts: [], contextsOk: true, marts: nodes.map((n) => ({ id: n.id, title: n.title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' })) },
  nodes, failed: new Map(),
});
const goal = { martId: 'orders', measure: { field: 'revenue', fn: 'SUM' as const }, dateField: 'date', kind: 'flow' as const, alias: 'Revenue', plan: null };
const filled: ProjectSettingsV5 = { ...EMPTY_SETUP, goal, coreClasses: ['users'], updatedAt: '2026-11-14T10:00:00.000Z', updatedBy: 'Ann' };

test('no goal blocks with NO_GOAL; a goal without a date blocks with GOAL_NO_DATE', () => {
  expect(deriveModel(EMPTY_SETUP, graph())).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
  expect(deriveModel({ ...filled, goal: { ...goal, dateField: null } }, graph())).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_DATE' } });
});

test('a goal Data Mart missing from the list blocks with GOAL_NO_ACCESS; a gone field with GOAL_FIELD_NOT_FOUND', () => {
  expect(deriveModel(filled, graph([users]))).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_ACCESS' } });
  expect(deriveModel({ ...filled, goal: { ...goal, measure: { field: 'gone', fn: 'SUM' } } }, graph())).toMatchObject({ ok: false, blocked: { code: 'GOAL_FIELD_NOT_FOUND' } });
});

test('a goal Data Mart whose schema read failed blocks with the reason, not the access message', () => {
  const g = { ...graph([users]), failed: new Map([['orders', 'boom']]) };
  g.inputs = { ...g.inputs, marts: [{ id: 'orders', title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' }] };
  const r = deriveModel(filled, g);
  expect(r).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_ACCESS', detail: "Couldn't check Orders: boom" } });
});

test('a filled project derives the goal class, the core class, the edge and the unique counts', () => {
  const r = deriveModel(filled, graph());
  if (!r.ok) throw new Error(r.blocked.code);
  const m = r.model;
  expect(m.goal).toEqual({ classId: 'orders', metricId: metricId('orders', goal.measure), goalMartId: 'orders', viaFallback: false });
  expect(m.classes.map((c) => [c.id, c.depth, c.core])).toEqual([['orders', 0, false], ['users', 1, true]]);
  expect(m.edges).toEqual([{ from: 'orders', to: 'users', fields: ['user_ref'] }]);
  expect(m.classes[0]!.keyMetricId).toBe('orders:revenue:SUM');
  expect(m.classes[1]!.keyMetricId).toBe('users:user_id:COUNT_DISTINCT');
  expect(m.builtAt).toBe('2026-11-14T10:00:00.000Z');
  expect(m.editedAt).toBeNull();
});

test('the same settings and schemas derive an equal model', () => {
  expect(deriveModel(filled, graph())).toEqual(deriveModel(filled, graph()));
});

test('a shown metric whose field is gone is left out, the rest of the model stays', () => {
  const s: ProjectSettingsV5 = { ...filled, classes: { users: { keyMetricId: null, shown: [{ martId: 'users', measure: { field: 'gone', fn: 'SUM' }, dateField: 'signup', kind: 'flow', alias: 'Gone' }, { martId: 'users', measure: { field: 'ltv', fn: 'SUM' }, dateField: 'signup', kind: 'flow', alias: 'LTV' }] } } };
  const r = deriveModel(s, graph());
  if (!r.ok) throw new Error();
  expect(r.model.classes[1]!.metricIds).toEqual(['users:user_id:COUNT_DISTINCT', 'users:ltv:SUM']);
});

test('class plans and formats apply to their metrics; a ratio lands on the numerator class', () => {
  const ratio = { id: ratioMetricId('orders:revenue:SUM', 'users:user_id:COUNT_DISTINCT'), name: 'Revenue per User', numerator: 'orders:revenue:SUM', denominator: 'users:user_id:COUNT_DISTINCT', format: 'currency' as const };
  const s: ProjectSettingsV5 = { ...filled, formats: { 'orders:revenue:SUM': { format: 'currency', currency: 'USD' } }, ratios: [ratio] };
  const r = deriveModel(s, graph());
  if (!r.ok) throw new Error();
  const byId = new Map(r.model.metrics.map((m) => [m.id, m]));
  expect(byId.get('orders:revenue:SUM')).toMatchObject({ format: 'currency', currency: 'USD', role: 'critical', source: 'project' });
  expect(byId.get(ratio.id)).toMatchObject({ martId: 'orders', alias: 'Revenue per User', ratio: { numerator: 'orders:revenue:SUM', denominator: 'users:user_id:COUNT_DISTINCT' }, format: 'currency' });
  expect(r.model.classes[0]!.metricIds).toContain(ratio.id);
});

test('a dropped ratio is never a class key: the key falls back to the unique count', () => {
  const ratio = { id: ratioMetricId('users:ltv:SUM', 'orders:gone:SUM'), name: 'R', numerator: 'users:ltv:SUM', denominator: 'orders:gone:SUM', format: 'number' as const };
  const sh = { martId: 'users', measure: { field: 'ltv', fn: 'SUM' as const }, dateField: 'signup', kind: 'flow' as const, alias: 'LTV' };
  const s: ProjectSettingsV5 = { ...filled, classes: { users: { keyMetricId: ratio.id, shown: [sh] } }, ratios: [ratio] };
  const r = deriveModel(s, graph());
  if (!r.ok) throw new Error();
  const u = r.model.classes[1]!;
  expect(u.keyMetricId).toBe('users:user_id:COUNT_DISTINCT');
  expect(u.metricIds).not.toContain(ratio.id);
});

test('a chosen keyMetricId is honoured', () => {
  const sh = { martId: 'users', measure: { field: 'ltv', fn: 'SUM' as const }, dateField: 'signup', kind: 'flow' as const, alias: 'LTV' };
  const r = deriveModel({ ...filled, classes: { users: { keyMetricId: 'users:ltv:SUM', shown: [sh] } } }, graph());
  if (!r.ok) throw new Error();
  expect(r.model.classes[1]!.keyMetricId).toBe('users:ltv:SUM');
  expect(r.model.classes[1]!.metricIds[0]).toBe('users:ltv:SUM');
});

test('GOAL_NO_DATE when the saved date field is gone from the schema', () => {
  expect(deriveModel({ ...filled, goal: { ...goal, dateField: 'gone' } }, graph())).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_DATE' } });
});

test('a shown choice of another Data Mart is ignored; a ratio of a ratio and a duplicate ratio are dropped', () => {
  const foreign = { martId: 'orders', measure: { field: 'revenue', fn: 'SUM' as const }, dateField: 'date', kind: 'flow' as const, alias: 'X' };
  const a = { id: ratioMetricId('orders:revenue:SUM', 'users:user_id:COUNT_DISTINCT'), name: 'A', numerator: 'orders:revenue:SUM', denominator: 'users:user_id:COUNT_DISTINCT', format: 'number' as const };
  const b = { id: 'ratio:b', name: 'B', numerator: a.id, denominator: 'users:user_id:COUNT_DISTINCT', format: 'number' as const };
  const r = deriveModel({ ...filled, classes: { users: { keyMetricId: null, shown: [foreign] } }, ratios: [a, a, b] }, graph());
  if (!r.ok) throw new Error();
  expect(r.model.classes[1]!.metricIds).toEqual(['users:user_id:COUNT_DISTINCT']);
  expect(r.model.classes[0]!.metricIds.filter((id) => id === a.id)).toHaveLength(1);
  expect(r.model.metrics.some((m) => m.id === b.id)).toBe(false);
});

test('inputHash changes when a field is added to a drawn Data Mart', () => {
  const wider = node('users', [field('user_id', 'STRING', { isPrimaryKey: true }), field('signup', 'DATE'), field('ltv', 'NUMERIC'), field('plan', 'STRING')], [], 'user_id');
  const h = (g: Graph) => { const r = deriveModel(filled, g); if (!r.ok) throw new Error(); return r.model.inputHash; };
  expect(h(graph([orders, wider]))).not.toBe(h(graph()));
  expect(h(graph())).toBe(h(graph()));
});
