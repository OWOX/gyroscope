import type { MetricDef, MetricResult, RangeSpec, SeriesPack } from '../types';
import { diffPct, statusOf } from '../lib/stats';
import type { OwoxLike } from '../owox/sources';
import { computeMetric, type ComputeOut } from './compute';

/** n ÷ d, or null when either is missing or d is 0. */
export const divide = (n: number | null, d: number | null): number | null => (n === null || d === null || d === 0 ? null : n / d);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The ratio's result from its two sides; the series is laid on the numerator's days. */
export function combineRatio(num: ComputeOut, den: ComputeOut, thresholdPct: number): ComputeOut {
  const n = num.result, d = den.result;
  const error = n.error ?? d.error;
  const base: MetricResult = {
    fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false,
    status: 'neutral', trend: 'flat', note: null, error: null,
  };
  if (error) return { result: { ...base, error }, spark: null };
  const fact = divide(n.fact, d.fact);
  const comparison = divide(n.comparison, d.comparison);
  const compareFact = divide(n.compareFact, d.compareFact);
  let spark: SeriesPack | null = null;
  if (num.spark && den.spark) {
    const shift = daysBetween(den.spark.start, num.spark.start);
    spark = { start: num.spark.start, values: num.spark.values.map((v, i) => divide(v, den.spark!.values[i + shift] ?? null)), forecastStart: null, forecast: [] };
  }
  const trend = n.trend === d.trend ? 'flat' : n.trend === 'up' || d.trend === 'down' ? 'up' : 'down';
  return { result: { ...base, fact, compareFact, comparison, diffPct: diffPct(compareFact ?? fact, comparison), status: statusOf(fact, null, thresholdPct), trend }, spark };
}

/** Computes both sides of a ratio metric with no plan or forecast, then divides. */
export async function computeRatio(args: { owox: OwoxLike; metric: MetricDef; byId: ReadonlyMap<string, MetricDef>; spec: RangeSpec; thresholdPct: number }): Promise<ComputeOut> {
  const { owox, metric, byId, spec, thresholdPct } = args;
  const fail = (error: string): ComputeOut => ({ result: { fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false, status: 'neutral', trend: 'flat', note: null, error }, spark: null });
  const { numerator, denominator } = metric.ratio!;
  const sides = [byId.get(numerator), byId.get(denominator)];
  const missing = sides.findIndex((m) => !m);
  if (missing >= 0) return fail(`Metric ${missing ? denominator : numerator} is not in the model`);
  if (sides.some((m) => m!.ratio)) return fail("A ratio can't divide another ratio");
  if (sides.some((m) => !m!.dateField) && sides.some((m) => m!.dateField)) return fail('Both numbers of a ratio need a date field');
  const side = (m: MetricDef) => computeMetric({ owox, metric: { ...m, plan: null, forecast: null }, spec, thresholdPct, withSpark: true });
  const [num, den] = await Promise.all([side(sides[0]!), side(sides[1]!)]);
  return combineRatio(num, den, thresholdPct);
}
