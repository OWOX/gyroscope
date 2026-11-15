import { describe, expect, test } from 'vitest';
import { pickPrimaryKey, repick } from './fixes';
import type { MartNode } from '../../model/graph';

const node = (id: string, names: [string, string, string?][]): MartNode => ({ id, title: id, contexts: [], blendable: { availableSources: [], mainUniqueCountKeyFields: [] },
  detail: { id, title: id, fields: names.map(([name, type, mode]) => ({ name, type, isPrimaryKey: false, ...(mode ? { mode } : {}) })) as never } });

describe('fix recommenders', () => {
  test('primary key: the id named after the Data Mart, required before nullable', () => {
    expect(pickPrimaryKey(node('orders', [['user_id', 'STRING'], ['order_id', 'STRING'], ['date', 'DATE']]))).toBe('order_id');
    expect(pickPrimaryKey(node('x', [['id', 'STRING', 'NULLABLE'], ['row_id', 'STRING', 'REQUIRED']]))).toBe('row_id');
    expect(pickPrimaryKey(node('x', [['date', 'DATE']]))).toBeNull();
  });

  test('repick: shared tokens first, then edit distance; filtered by keep', () => {
    const n = node('orders', [['net_revenue', 'NUMERIC'], ['revenue_usd', 'NUMERIC'], ['date', 'DATE']]);
    expect(repick('revenue', n, (f) => f.type !== 'DATE')!.path).toBe('revenue_usd');
    expect(repick('revenue', n, () => false)).toBeNull();
  });
});
