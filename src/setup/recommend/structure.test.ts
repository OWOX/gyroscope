import { describe, expect, test } from 'vitest';
import { coreCandidates, coreDefault, keyFor, ratioPairs, shownFor, teamDrafts } from './structure';
import type { MartNode } from '../../model/graph';
import type { Model } from '../../types';

const node = (id: string, fields: object[] = [{ name: `${id}_id`, type: 'STRING', isPrimaryKey: true }], sources: string[] = []): MartNode =>
  ({ id, title: id, contexts: [], detail: { id, title: id, fields: fields as never }, blendable: { availableSources: sources.map((s) => ({ aliasPath: s, dataMartId: s, title: s, isAccessibleForReporting: true })), mainUniqueCountKeyFields: [] } });
const ref = (path: string, field: string) => `{{ref path="${path}" field="${field}"}}`;

describe('structure recommenders', () => {
  test('core: still-valid legacy ids first, then the ranking; default count is the inbound>=2 candidates within 3..7', () => {
    const nodes = ['goal', 'users', 'products', 'stores', 'promos'].map((x) => node(x));
    const edges = [
      { from: 'goal', to: 'users' }, { from: 'goal', to: 'products' }, { from: 'goal', to: 'stores' }, { from: 'goal', to: 'promos' },
      { from: 'stores', to: 'users' }, { from: 'promos', to: 'products' },
    ];
    const c = coreCandidates('goal', nodes, edges, ['stores', 'gone']);
    expect(c[0]).toBe('stores');
    expect(c).not.toContain('gone');
    expect(coreDefault(c, edges)).toHaveLength(3);
  });

  const metric = (id: string, martId: string, over: object = {}) => ({ id, martId, alias: id, measure: { field: id.split(':')[1]!, fn: 'SUM' }, kind: 'flow', dateField: 'd', role: 'leading', source: 'project', isUniqueCount: false, plan: null, shown: true, format: 'number', currency: null, forecast: null, ...over });
  const model = (over: Partial<Model> = {}): Model => ({
    version: 3, inputHash: '', builtAt: '', builtBy: '', editedAt: null, editedBy: null,
    goal: { classId: 'orders', metricId: 'orders:revenue:SUM', goalMartId: 'orders', viaFallback: false },
    classes: [
      { id: 'orders', martId: 'orders', title: 'Orders', contexts: [], depth: 0, keyMetricId: 'orders:revenue:SUM', metricIds: ['orders:revenue:SUM'], shown: true, core: false, inbound: 0 },
      { id: 'sessions', martId: 'sessions', title: 'Sessions', contexts: [], depth: 1, keyMetricId: 'sessions:sessions:SUM', metricIds: ['sessions:sessions:SUM', 'sessions:id:COUNT_DISTINCT'], shown: true, core: true, inbound: 1 },
    ],
    edges: [{ from: 'orders', to: 'sessions', fields: ['session_ref'] }],
    metrics: [metric('orders:revenue:SUM', 'orders', { alias: 'Revenue' }), metric('sessions:sessions:SUM', 'sessions', { alias: 'Sessions' }), metric('sessions:id:COUNT_DISTINCT', 'sessions', { isUniqueCount: true, measure: { field: 'id', fn: 'COUNT_DISTINCT' } })] as never,
    ...over,
  });

  test('key: a metric with a plan, else the unique count', () => {
    expect(keyFor('sessions', model())).toBe('sessions:id:COUNT_DISTINCT');
    const m = model();
    (m.metrics[1] as { plan: unknown }).plan = { martId: 'p', measure: { field: 'x', fn: 'SUM' }, dateField: 'd', shape: 'daily' };
    expect(keyFor('sessions', m)).toBe('sessions:sessions:SUM');
  });

  test('shown: planned fields, then calculated, then numeric; never the key field; at most 3', () => {
    const n = node('sessions', [
      { name: 'sessions', type: 'INT64', isPrimaryKey: false }, { name: 'a', type: 'INT64', isPrimaryKey: false }, { name: 'b', type: 'INT64', isPrimaryKey: false },
      { name: 'c', type: 'NUMERIC', isPrimaryKey: false, calculated: { formula: '1', level: 'metric' } }, { name: 'd', type: 'INT64', isPrimaryKey: false },
    ]);
    const m = model();
    const plan = { martId: 'p', measure: { field: 'x', fn: 'SUM' }, dateField: 'd', shape: 'daily' };
    (m.metrics[1] as { plan: unknown }).plan = plan; // the first planned metric is the key
    (m.metrics[2] as { plan: unknown; measure: unknown }).plan = plan;
    (m.metrics[2] as { measure: unknown }).measure = { field: 'b', fn: 'COUNT' };
    expect(shownFor('sessions', m, n).map((x) => x.path)).toEqual(['b', 'c', 'a']);
  });

  test('ratio pairs: connected classes with keys, numerator on the edge source', () => {
    const nodes = [node('orders', [{ name: 'session_ref', type: 'STRING', isPrimaryKey: false, calculated: { formula: ref('sessions', 'session_id') } }], ['sessions']), node('sessions')];
    expect(ratioPairs(model(), nodes)).toEqual([{ numerator: 'orders:revenue:SUM', denominator: 'sessions:sessions:SUM', name: 'Revenue per Sessions' }]);
  });

  test('shown excludes the saved key field, not the recommended one', () => {
    const n = node('sessions', [{ name: 'sessions', type: 'INT64', isPrimaryKey: false }, { name: 'a', type: 'INT64', isPrimaryKey: false }]);
    const m = model();
    (m.classes[1] as { keyMetricId: string }).keyMetricId = 'sessions:a:SUM';
    (m.metrics as unknown[]).push(metric('sessions:a:SUM', 'sessions'));
    (m.classes[1] as { metricIds: string[] }).metricIds.push('sessions:a:SUM');
    expect(keyFor('sessions', m)).toBe('sessions:id:COUNT_DISTINCT');
    expect(shownFor('sessions', m, n).map((x) => x.path)).toEqual(['sessions']);
  });

  test('ratio pairs skip ratio metrics and metrics without a date', () => {
    const nodes = [node('orders', [{ name: 'session_ref', type: 'STRING', isPrimaryKey: false, calculated: { formula: ref('sessions', 'session_id') } }], ['sessions']), node('sessions')];
    const a = model(); (a.metrics[0] as { ratio: unknown }).ratio = { numerator: 'x', denominator: 'y' };
    const b = model(); (b.metrics[1] as { dateField: null }).dateField = null;
    expect(ratioPairs(a, nodes)).toEqual([]);
    expect(ratioPairs(b, nodes)).toEqual([]);
  });

  test('ratio pairs skip a pair where a calculated field already references the other key field', () => {
    const nodes = [node('orders', [{ name: 'per', type: 'NUMERIC', isPrimaryKey: false, calculated: { formula: ref('sessions', 'sessions') } }], ['sessions']), node('sessions')];
    expect(ratioPairs(model(), nodes)).toEqual([]);
  });

  test('team drafts group Data Marts by title keywords, each in the first group it matches', () => {
    const nodes = ['Google Ads', 'Campaigns', 'Orders', 'Leads', 'Weather'].map((t) => ({ ...node(t.toLowerCase().replace(' ', '_')), title: t }));
    expect(teamDrafts(nodes)).toEqual([{ name: 'Marketing', martIds: ['google_ads', 'campaigns'] }, { name: 'Sales', martIds: ['orders', 'leads'] }]);
  });
});
