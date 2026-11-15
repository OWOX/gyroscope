import type { Edge, Measure, MetricFormat, MetricKind, PlanShape } from '../../types';
import { DATE_TYPES, flattenFields, type SchemaField } from '../../owox/sources';
import type { MartNode } from '../../model/graph';
import { hasPrimaryKey } from '../../model/graph';
import { inboundCounts } from '../../model/core';
import { criticalRow, findMetricRows, isFieldLink } from '../tables';
import { normalizeCurrency } from '../../lib/format';

export interface FieldCand { martId: string; martTitle: string; path: string; label: string; type: string }
export const NUMERIC = /NUMERIC|FLOAT|INT|DECIMAL|DOUBLE|BIGNUMERIC|NUMBER/;
const MONEY = /revenue|sales|profit|gmv|amount|income|margin/i;
const COUNT = /orders?|deals?|sessions?|users?|signups?|installs?|leads?|qty|quantity|count/i;
const PLAN_TOKENS = new Set(['plan', 'plans', 'target', 'targets', 'budget', 'budgets', 'forecast', 'forecasts', 'planned', 'budgeted', 'forecasted', 'targeted']);
const LEVEL_TOKENS = new Set(['balance', 'stock', 'active', 'mrr', 'arr', 'headcount', 'inventory']);
/** Lower-case words of a name: camelCase boundaries, `_`, spaces and punctuation all separate. */
const tokens = (text: string): string[] => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const PLAN = { test: (text: string) => tokens(text).some((t) => PLAN_TOKENS.has(t)) };
const LEVEL = { test: (text: string) => tokens(text).some((t) => LEVEL_TOKENS.has(t)) };
const RATE = new Set(['rate', 'share', 'ratio', 'percent', 'pct', 'cr', 'ctr']);
const MONEY_FORMAT = /revenue|sales|profit|gmv|amount|income|margin|cost|price|spend/i;
const DATE_NAME = /(^|[^a-z])(date|day|created|order|event)/i;
const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₴': 'UAH' };
const CODES = /(?<![a-z])(USD|EUR|GBP|UAH|PLN|CAD|AUD|CHF|JPY|CNY|INR|BRL|SEK|NOK|DKK|CZK|TRY)(?![a-z])/i;

export const cands = (n: MartNode, keep: (type: string, text: string, field: SchemaField) => boolean): FieldCand[] =>
  flattenFields(n.detail.fields).flatMap(({ path, field }) => {
    const type = field.calculated?.level === 'metric' ? 'METRIC' : field.type.toUpperCase();
    const text = `${field.name} ${field.alias ?? ''}`;
    return keep(type, text, field) ? [{ martId: n.id, martTitle: n.title, path, label: field.alias || field.name, type }] : [];
  });
const ID_NAME = (name: string) => /(^|_)id$/i.test(name) || /[a-z]Id$/.test(name);
const isNumber = (type: string) => type === 'METRIC' || (NUMERIC.test(type) && !DATE_TYPES.has(type));

/** Numeric and metric-level fields of the Data Marts, leaving out dates and plan-like names. */
export const numericFields = (nodes: MartNode[]): FieldCand[] => nodes.flatMap((n) => cands(n, (t, x, f) => isNumber(t) && !PLAN.test(x) && !f.isPrimaryKey && !ID_NAME(f.name)));

/**
 * The field the description's Metrics table names as its critical number comes first. Then fields whose Data Mart has a primary key
 * and a date field (the canvas needs both); within each group money names, then counts, then the rest, ties to the Data Mart more others reference.
 */
export function criticalCandidates(nodes: MartNode[], edges: Edge[], hint?: { description: string | null | undefined; source: 'project' | string }): FieldCand[] {
  const inbound = inboundCounts(edges);
  const rank = (c: FieldCand) => (MONEY.test(c.label) ? 0 : COUNT.test(c.label) ? 1 : 2);
  const usable = new Map(nodes.map((n) => [n.id, hasPrimaryKey(n.detail) && dateCandidates(n).length > 0]));
  const link = hint ? criticalRow(findMetricRows(hint.description, hint.source))?.fact.find(isFieldLink) : undefined;
  const named = (c: FieldCand) => !!link && c.martId.toLowerCase() === link.martId && c.path === link.field;
  return numericFields(nodes).map((c, i) => ({ c, i })).sort((a, b) =>
    +named(b.c) - +named(a.c) || +!!usable.get(b.c.martId) - +!!usable.get(a.c.martId) || rank(a.c) - rank(b.c) || (inbound.get(b.c.martId) ?? 0) - (inbound.get(a.c.martId) ?? 0) || a.i - b.i).map((x) => x.c);
}

/** Date fields of a Data Mart: DATE before timestamps, names with date or day first. */
export function dateCandidates(node: MartNode): FieldCand[] {
  const rank = (c: FieldCand) => (c.type === 'DATE' ? 0 : 1) * 2 + (DATE_NAME.test(c.label) || /[a-z](Date|Day|Created)/.test(c.label) ? 0 : 1);
  return cands(node, (t) => DATE_TYPES.has(t)).map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** SUM for a column, no aggregation for a metric-level calculated field; balance-like names are levels. */
export const kindFor = (f: FieldCand): { measure: Measure; kind: MetricKind } =>
  ({ measure: { field: f.path, fn: f.type === 'METRIC' ? null : 'SUM' }, kind: LEVEL.test(f.label) ? 'level' : 'flow' });

/** Plan-like numeric fields; the preferred Data Mart's come first. */
export function planCandidates(nodes: MartNode[], prefer?: string): FieldCand[] {
  const all = nodes.flatMap((n) => cands(n, (t, x) => isNumber(t) && PLAN.test(x)));
  return [...all.filter((c) => c.martId === prefer), ...all.filter((c) => c.martId !== prefer)];
}

/** Cumulative when every value is at least the one before it; a level kind gives a level plan. */
export function shapeFor(planDaily: number[] | null, kind: MetricKind): PlanShape {
  if (kind === 'level') return 'level';
  if (!planDaily || planDaily.length < 3) return 'daily';
  return planDaily.every((v, i) => i === 0 || v >= planDaily[i - 1]!) && planDaily[planDaily.length - 1]! > planDaily[0]! ? 'cumulative' : 'daily';
}

/** Percent for rates, currency for money names or a currency mark, else number. */
export function formatFor(label: string): { format: MetricFormat; currency: string | null } {
  if (label.toLowerCase().split(/[^a-z0-9]+/).some((t) => RATE.has(t))) return { format: 'percent', currency: null };
  const mark = label.match(CODES)?.[0].toUpperCase() ?? label.match(/[$€£₴]/)?.[0];
  if (MONEY_FORMAT.test(label) || mark) return { format: 'currency', currency: mark ? normalizeCurrency(SYMBOLS[mark] ?? mark) : null };
  return { format: 'number', currency: null };
}
