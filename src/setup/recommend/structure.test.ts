import { describe, expect, test } from 'vitest';
import { coreCandidates, coreChoices, coreDefault, linkedIds, keyFor, ratioPairs, shownFor, teamDrafts } from './structure';
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

  describe('core reach, links and manual picks', () => {
    const src = (aliasPath: string, dataMartId: string, ok = true) => ({ aliasPath, dataMartId, title: dataMartId, isAccessibleForReporting: ok });
    const titled = (id: string, title: string, fields?: object[]): MartNode => ({ ...node(id, fields), title });
    const goalWith = (...sources: ReturnType<typeof src>[]): MartNode => ({ ...node('goal'), blendable: { availableSources: sources, mainUniqueCountKeyFields: [] } });
    const text = (projectDescription: string | null, ...contexts: string[]) => ({ projectDescription, contexts: contexts.map((d, i) => ({ id: `c${i}`, description: d })) });

    test('indirect marts are candidates, ranked after direct ones; the fewest hops wins per mart', () => {
      const nodes = [goalWith(src('cust', 'cust'), src('cust.org', 'org'), src('cust.org.user', 'user'), src('user', 'user')), node('cust'), node('org'), node('user')];
      expect(coreChoices('goal', nodes, [], []).ranked).toEqual(['cust', 'user', 'org']);
    });

    test('a Markdown link by Data Mart id ranks first and is the default; with none linked the old rule applies', () => {
      const nodes = [goalWith(src('a', 'a'), src('a.b', 'b'), src('a.b.c', 'c')), titled('a', 'Alpha'), titled('b', '🥈 Customer | Entity'), titled('c', 'Gamma')];
      const withField = coreChoices('goal', nodes, [], [], text('Revenue: [🥈 Customer](https://app.owox.com/ui/p1/data-marts/b/data-setup?field=revenue+total#x).'));
      expect(withField.ranked).toEqual(['b', 'a', 'c']);
      expect(coreDefault(withField.ranked, [], withField.mentioned)).toEqual(['b']);
      const relative = coreChoices('goal', nodes, [], [], text(null, 'see [Gamma](/ui/p1/data-marts/c/data-setup)'));
      expect(relative.ranked[0]).toBe('c');
      expect(relative.mentioned).toEqual(['c']);
      expect(coreChoices('goal', nodes, [], []).mentioned).toEqual([]);
      expect(coreDefault(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
    });

    test('plain title text no longer matches', () => {
      const nodes = [goalWith(src('a', 'a'), src('b', 'b')), titled('a', 'Alpha'), titled('b', 'Customer')];
      const c = coreChoices('goal', nodes, [], [], text('Revenue comes from each Customer, see https://x/ui/p/data-marts/b/data-setup'));
      expect(c.mentioned).toEqual([]);
    });

    test('an id that is not reachable is not offered', () => {
      const nodes = [goalWith(src('a', 'a'), src('a.b', 'b')), titled('a', 'Alpha'), titled('b', 'Beta'), titled('far', 'Faraway')];
      const c = coreChoices('goal', nodes, [], [], text('[Beta](/ui/p/data-marts/b/x), [Far](/ui/p/data-marts/far/x), [Ghost](/ui/p/data-marts/ghost/x)'));
      expect(c.ranked).toEqual(['b', 'a']);
      expect(c.mentioned).toEqual(['b']);
      expect(c.order).toEqual(['b', 'a']);
    });

    test('linkedIds reads the id after /data-marts/, URL-decoded', () => {
      expect([...linkedIds('[x](https://h/ui/p/data-marts/ab%2D1/data-setup?field=a) [y](/data-marts/z#h) plain /data-marts/q')]).toEqual(['ab-1', 'z']);
    });

    test('only reachable single-key marts are offered: not unrelated, multi-key, inaccessible or the goal', () => {
      const multi = node('multi', [{ name: 'a', type: 'STRING', isPrimaryKey: true }, { name: 'b', type: 'STRING', isPrimaryKey: true }]);
      const nodes = [goalWith(src('near', 'near'), src('hid', 'hid', false), src('multi', 'multi')), node('near'), node('zeta'), node('alpha'), node('hid'), multi];
      expect(coreCandidates('goal', nodes, [], ['zeta', 'near'])).toEqual(['near']);
    });

    test('calculated-field edges still make direct candidates', () => {
      const nodes = [node('goal'), node('x'), node('y')];
      expect(coreChoices('goal', nodes, [{ from: 'goal', to: 'x' }], []).ranked).toEqual(['x']);
    });
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
