import type { Edge } from '../types';
import { inboundCounts, singleKey } from './core';

const e = (from: string, to: string): Edge => ({ from, to });
test('inboundCounts counts distinct referrers', () => {
  expect(inboundCounts([e('a', 'x'), e('b', 'x'), { ...e('a', 'x'), fields: ['f'] }, e('a', 'y')])).toEqual(new Map([['x', 2], ['y', 1]]));
});

test('singleKey needs exactly one primary key path', () => {
  const f = (name: string, pk: boolean) => ({ name, type: 'STRING', isPrimaryKey: pk });
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', true)] })).toBe(true);
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', true), f('b', true)] })).toBe(false);
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', false)] })).toBe(false);
});
