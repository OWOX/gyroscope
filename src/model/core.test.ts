import type { Edge } from '../types';
import { inboundCounts, rankCore, singleKey } from './core';

const e = (from: string, to: string): Edge => ({ from, to });
test('ranks by inbound references, then links to other candidates, then title', () => {
  const nodes = [
    { id: 'rev', title: 'Revenue', singleKey: true }, { id: 'cus', title: 'Customers', singleKey: true },
    { id: 'pro', title: 'Products', singleKey: true }, { id: 'vis', title: 'Visitors', singleKey: true },
    { id: 'cmp', title: 'Composite', singleKey: false }, { id: 'far', title: 'Far', singleKey: true },
  ];
  const edges = [e('rev', 'cus'), e('rev', 'pro'), e('x', 'cus'), e('y', 'cus'), e('x', 'pro'), e('rev', 'vis'), e('rev', 'cmp'), e('x', 'far'), e('cus', 'pro')];
  expect(rankCore({ goalId: 'rev', nodes, edges })).toEqual(['cus', 'pro', 'vis']);
});

test('ties on inbound go to more distinct neighbouring candidates, then title', () => {
  const nodes = [
    { id: 'g', title: 'Goal', singleKey: true }, { id: 'a', title: 'Alpha', singleKey: true },
    { id: 'm', title: 'Mid', singleKey: true }, { id: 'z', title: 'Zed', singleKey: true },
  ];
  // inbound is 3 for all. Mid touches Zed (both ways, one neighbour) and Alpha: 2 neighbours. Alpha and Zed have 1 each.
  const edges = [e('g', 'a'), e('g', 'm'), e('g', 'z'), e('z', 'm'), e('m', 'z'), e('a', 'm'), e('p1', 'z'), e('p1', 'a'), e('p2', 'a')];
  expect(inboundCounts(edges)).toEqual(new Map([['a', 3], ['m', 3], ['z', 3]]));
  expect(rankCore({ goalId: 'g', nodes, edges })).toEqual(['m', 'a', 'z']);
});

test('a candidate that only references the goal counts as connected but needs inbound references', () => {
  const nodes = [{ id: 'rev', title: 'Revenue', singleKey: true }, { id: 'ses', title: 'Sessions', singleKey: true }];
  expect(rankCore({ goalId: 'rev', nodes, edges: [e('ses', 'rev')] })).toEqual([]);
  expect(rankCore({ goalId: 'rev', nodes, edges: [e('ses', 'rev'), e('z', 'ses')] })).toEqual(['ses']);
});

test('inboundCounts counts distinct referrers', () => {
  expect(inboundCounts([e('a', 'x'), e('b', 'x'), { ...e('a', 'x'), fields: ['f'] }, e('a', 'y')])).toEqual(new Map([['x', 2], ['y', 1]]));
});

test('singleKey needs exactly one primary key path', () => {
  const f = (name: string, pk: boolean) => ({ name, type: 'STRING', isPrimaryKey: pk });
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', true)] })).toBe(true);
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', true), f('b', true)] })).toBe(false);
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', false)] })).toBe(false);
});
