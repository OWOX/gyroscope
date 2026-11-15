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
