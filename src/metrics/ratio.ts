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
  let spark: SeriesPack | null = null;
  if (num.spark && den.spark) {
    const shift = daysBetween(den.spark.start, num.spark.start);
    spark = { start: num.spark.start, values: num.spark.values.map((v, i) => divide(v, den.spark!.values[i + shift] ?? null)), forecastStart: null, forecast: [] };
  }
  const trend = n.trend === d.trend ? 'flat' : n.trend === 'up' || d.trend === 'down' ? 'up' : 'down';
  return { result: { ...base, fact, comparison, diffPct: diffPct(fact, comparison), status: statusOf(fact, null, thresholdPct), trend }, spark };
}

/** Computes both sides of a ratio metric with no plan or forecast, then divides. */
export async function computeRatio(args: { owox: OwoxLike; metric: MetricDef; byId: ReadonlyMap<string, MetricDef>; spec: RangeSpec; thresholdPct: number }): Promise<ComputeOut> {
  const { owox, metric, byId, spec, thresholdPct } = args;
  const side = (id: string) => {
    const m = byId.get(id);
    if (!m) return Promise.resolve<ComputeOut>({ result: { fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false, status: 'neutral', trend: 'flat', note: null, error: `Metric ${id} is not in the model` }, spark: null });
    return computeMetric({ owox, metric: { ...m, plan: null, forecast: null }, spec, thresholdPct, withSpark: true });
  };
  const [num, den] = await Promise.all([side(metric.ratio!.numerator), side(metric.ratio!.denominator)]);
  return combineRatio(num, den, thresholdPct);
}
