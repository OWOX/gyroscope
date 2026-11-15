import { combineRatio, computeRatio, divide } from './ratio';
import { fakeOwox } from '../owox/fake';
import { rangeFor } from '../lib/dates';
import type { ComputeOut } from './compute';
import type { MetricDef, MetricResult } from '../types';

const res = (over: Partial<MetricResult>): MetricResult => ({
  fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false,
  status: 'neutral', trend: 'flat', note: null, error: null, ...over,
});
const out = (fact: number | null, comparison: number | null, values: (number | null)[]): ComputeOut =>
  ({ result: res({ fact, comparison }), spark: { start: '2026-11-01', values, forecastStart: null, forecast: [] } });

test('divide: a zero or missing side gives null, never Infinity or NaN', () => {
  expect(divide(10, 4)).toBe(2.5);
  expect(divide(10, 0)).toBeNull();
  expect(divide(null, 4)).toBeNull();
  expect(divide(0, 0)).toBeNull();
});

test('value, comparison and diff are the quotients; series divide day by day', () => {
  const r = combineRatio(out(50, 40, [5, 0, null, 6]), out(1000, 1000, [100, 0, 50, 0]), 20);
  expect(r.result.fact).toBe(0.05);
  expect(r.result.comparison).toBe(0.04);
  expect(r.result.diffPct).toBeCloseTo(25);
  expect(r.spark!.values).toEqual([0.05, null, null, null]);
  expect(r.result.status).toBe('neutral');
});

test('an error on either side is the ratio error', () => {
  const bad: ComputeOut = { result: res({ error: 'boom' }), spark: null };
  expect(combineRatio(bad, out(1, 1, []), 20).result.error).toBe('boom');
  expect(combineRatio(out(1, 1, []), bad, 20).result.error).toBe('boom');
});

test('series of different starts are aligned on the numerator start', () => {
  const den: ComputeOut = { result: res({ fact: 10 }), spark: { start: '2026-10-31', values: [1, 2, 4], forecastStart: null, forecast: [] } };
  const r = combineRatio(out(5, null, [4, 8]), den, 20);
  expect(r.spark!.values).toEqual([2, 2]);
});

test('with a compare fact, the diff is measured from it; a nulled comparison nulls the diff', () => {
  const side = (fact: number, compareFact: number | null, comparison: number | null): ComputeOut => ({ result: res({ fact, compareFact, comparison }), spark: null });
  const r = combineRatio(side(50, 25, 40), side(100, 100, 100), 20);
  expect(r.result.compareFact).toBe(0.25);
  expect(r.result.comparison).toBe(0.4);
  expect(r.result.diffPct).toBeCloseTo(-37.5);
  const cut = combineRatio(side(50, null, null), side(100, null, 100), 20);
  expect(cut.result.comparison).toBeNull();
  expect(cut.result.diffPct).toBeNull();
});

describe('computeRatio guards', () => {
  const m = (id: string, over: Partial<MetricDef> = {}): MetricDef => ({ id, martId: 'a', alias: id, measure: { field: 'x', fn: 'SUM' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, ...over });
  const run = async (metrics: MetricDef[]) => {
    const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [] });
    const r = m('r', { ratio: { numerator: metrics[0]!.id, denominator: metrics[1]!.id } });
    const out = await computeRatio({ owox, metric: r, byId: new Map([...metrics, r].map((x) => [x.id, x])), spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), thresholdPct: 20 });
    return { out, calls: owox.calls.filter((c) => c.path.startsWith('traverse')).length };
  };
  test("a side that is a ratio is an error, without querying (self-reference included)", async () => {
    const x = await run([m('a', { ratio: { numerator: 'a', denominator: 'a' } }), m('b')]);
    expect(x.out.result.error).toBe("A ratio can't divide another ratio");
    expect(x.calls).toBe(0);
    const self = await computeRatio({ owox: fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [] }), metric: m('r', { ratio: { numerator: 'r', denominator: 'b' } }), byId: new Map([['r', m('r', { ratio: { numerator: 'r', denominator: 'b' } })], ['b', m('b')]]), spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), thresholdPct: 20 });
    expect(self.result.error).toBe("A ratio can't divide another ratio");
  });
  test('one side without a date field is an error, without querying', async () => {
    const x = await run([m('a'), m('b', { dateField: null })]);
    expect(x.out.result.error).toBe('Both numbers of a ratio need a date field');
    expect(x.calls).toBe(0);
  });
});
