import { combineRatio, divide } from './ratio';
import type { ComputeOut } from './compute';
import type { MetricResult } from '../types';

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
