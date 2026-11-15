import { describe, expect, test } from 'vitest';
import { criticalCandidates, dateCandidates, formatFor, kindFor, numericFields, planCandidates, shapeFor } from './fields';
import type { MartNode } from '../../model/graph';

const f = (name: string, type: string, over: object = {}) => ({ name, type, isPrimaryKey: false, ...over });
const node = (id: string, fields: object[]): MartNode => ({ id, title: id, contexts: [], detail: { id, title: id, fields: fields as never }, blendable: { availableSources: [], mainUniqueCountKeyFields: [] } });
const orders = node('orders', [f('order_id', 'STRING', { isPrimaryKey: true }), f('created_at', 'TIMESTAMP'), f('order_date', 'DATE'), f('revenue', 'NUMERIC'), f('qty', 'INT64'), f('revenue_plan', 'NUMERIC')]);
const sessions = node('sessions', [f('date', 'DATE'), f('sessions', 'INT64'), f('bounce_rate', 'FLOAT64')]);

describe('field recommenders', () => {
  test('numeric fields leave out dates and plan-like names', () => {
    expect(numericFields([orders]).map((x) => x.path)).toEqual(['revenue', 'qty']);
  });

  test('critical candidates put money first, then counts, then the most referenced Data Mart', () => {
    const edges = [{ from: 'sessions', to: 'orders' }, { from: 'x', to: 'orders' }];
    expect(criticalCandidates([sessions, orders], edges).map((x) => `${x.martId}.${x.path}`).slice(0, 3)).toEqual(['orders.revenue', 'orders.qty', 'sessions.sessions']);
  });

  test('dates: DATE before TIMESTAMP, names with date first', () => {
    expect(dateCandidates(orders).map((x) => x.path)).toEqual(['order_date', 'created_at']);
  });

  test('kind: amounts are SUM flows; balance-like names are levels; a metric-level calculated field has no aggregation', () => {
    expect(kindFor({ martId: 'm', martTitle: 'm', path: 'revenue', label: 'revenue', type: 'NUMERIC' })).toEqual({ measure: { field: 'revenue', fn: 'SUM' }, kind: 'flow' });
    expect(kindFor({ martId: 'm', martTitle: 'm', path: 'mrr', label: 'MRR', type: 'NUMERIC' }).kind).toBe('level');
    expect(kindFor({ martId: 'm', martTitle: 'm', path: 'cr', label: 'cr', type: 'METRIC' }).measure.fn).toBeNull();
  });

  test('plan candidates are plan-like names; a preferred Data Mart comes first', () => {
    expect(planCandidates([sessions, orders], 'orders').map((x) => x.path)).toEqual(['revenue_plan']);
  });

  test('every number of a plan-titled Data Mart is a plan candidate and none is a critical one; month and period dates rank first', () => {
    const plans = { ...node('plans', [f('id', 'STRING', { isPrimaryKey: true }), f('retail_net_sales_month', 'NUMERIC'), f('created_at', 'TIMESTAMP'), f('month', 'DATE')]), title: 'Plan Data_Revenue' };
    expect(planCandidates([plans]).map((x) => x.path)).toEqual(['retail_net_sales_month']);
    expect(numericFields([plans, orders]).map((x) => x.martId)).not.toContain('plans');
    expect(dateCandidates(plans).map((x) => x.path)).toEqual(['month', 'created_at']);
  });

  test('shape: values that only grow within the month are cumulative', () => {
    expect(shapeFor([10, 20, 30, 40], 'flow')).toBe('cumulative');
    expect(shapeFor([10, 12, 9, 11], 'flow')).toBe('daily');
    expect(shapeFor(null, 'level')).toBe('level');
    expect(shapeFor(null, 'flow')).toBe('daily');
  });

  test('format from the name', () => {
    expect(formatFor('Bounce rate')).toEqual({ format: 'percent', currency: null });
    expect(formatFor('Revenue, USD')).toEqual({ format: 'currency', currency: 'USD' });
    expect(formatFor('Price $')).toEqual({ format: 'currency', currency: 'USD' });
    expect(formatFor('Sessions')).toEqual({ format: 'number', currency: null });
  });

  test('ids and primary keys never count as numbers', () => {
    const n = node('o', [f('order_id', 'INT64'), f('user_id', 'INT64'), f('pk', 'INT64', { isPrimaryKey: true }), f('orderId', 'INT64'), f('paid', 'INT64'), f('revenue', 'NUMERIC')]);
    expect(numericFields([n]).map((x) => x.path)).toEqual(['paid', 'revenue']);
    expect(criticalCandidates([n], []).map((x) => x.path)).not.toContain('order_id');
  });

  test('dates: created and event names rank up', () => {
    const n = node('o', [f('updated_at', 'TIMESTAMP'), f('created_at', 'TIMESTAMP')]);
    expect(dateCandidates(n).map((x) => x.path)).toEqual(['created_at', 'updated_at']);
  });

  test('format: whole-token rates, cost words, codes in names', () => {
    expect(formatFor('Conversions')).toEqual({ format: 'number', currency: null });
    expect(formatFor('Generated revenue').format).toBe('currency');
    expect(formatFor('Ad cost').format).toBe('currency');
    expect(formatFor('revenue_usd')).toEqual({ format: 'currency', currency: 'USD' });
    expect(formatFor('bounce_rate')).toEqual({ format: 'percent', currency: null });
  });
});

describe('level and plan names are whole tokens', () => {
  const k = (label: string) => kindFor({ martId: 'm', martTitle: 'm', path: label, label, type: 'NUMERIC' }).kind;
  test('level words match on their own, across separators and camelCase', () => {
    for (const l of ['balance', 'stock_level', 'Active users', 'mrr', 'ARR', 'headcount', 'inventory', 'activeUsers', 'net-arr']) expect(k(l), l).toBe('level');
  });
  test('words that merely contain a level word stay flows', () => {
    for (const l of ['arrivals', 'carrier', 'warranty', 'inactive_users', 'revenue']) expect(k(l), l).toBe('flow');
  });
  test('planned and budgeted columns are plans, not facts', () => {
    const n = node('p', [f('planned_revenue', 'NUMERIC'), f('budgetedSales', 'NUMERIC'), f('revenue', 'NUMERIC')]);
    expect(planCandidates([n]).map((x) => x.path)).toEqual(['planned_revenue', 'budgetedSales']);
    expect(numericFields([n]).map((x) => x.path)).toEqual(['revenue']);
  });
  test('goal is not a plan name: goal_completions is a number, not a plan', () => {
    const n = node('g', [f('goal_completions', 'INT64'), f('revenue_plan', 'NUMERIC'), f('sales_target', 'NUMERIC'), f('budget', 'NUMERIC'), f('forecastRevenue', 'NUMERIC')]);
    expect(numericFields([n]).map((x) => x.path)).toEqual(['goal_completions']);
    expect(planCandidates([n]).map((x) => x.path)).toEqual(['revenue_plan', 'sales_target', 'budget', 'forecastRevenue']);
  });
});

describe('critical candidates need to unblock the canvas', () => {
  const keyed = node('keyed', [f('id', 'STRING', { isPrimaryKey: true }), f('day', 'DATE'), f('qty', 'INT64')]);
  const loose = node('loose', [f('revenue', 'NUMERIC')]);
  test('a Data Mart with a primary key and a date field ranks above one without, whatever the names', () => {
    expect(criticalCandidates([loose, keyed], []).map((x) => x.path)).toEqual(['qty', 'revenue']);
  });
  test('the field the description names as critical comes first', () => {
    const two = node('0f0e0d0c-0b0a-4908-8706-050403020100', [f('id', 'STRING', { isPrimaryKey: true }), f('day', 'DATE'), f('revenue', 'NUMERIC'), f('profit', 'NUMERIC')]);
    const md = `| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Profit | | [Profit](/ui/p/data-marts/${two.id}/data-setup?field=profit) |`;
    expect(criticalCandidates([two, loose], [], { description: md, source: 'project' })[0]!.path).toBe('profit');
    expect(criticalCandidates([two, loose], [], { description: null, source: 'project' })[0]!.path).toBe('revenue');
    const gone = md.replace('field=profit', 'field=nope');
    expect(criticalCandidates([two, loose], [], { description: gone, source: 'project' })[0]!.path).toBe('revenue');
  });
});
