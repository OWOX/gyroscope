import { expect, test } from 'vitest';
import { AI_ROWS, aiPick, factsHash } from './ai';
import type { Row } from './types';

const row = (id: string, ids: string[]): Row => ({ id, block: 'goal', title: 'Business Critical Number', question: 'What is the main business goal?', why: '', severity: 'error', state: 'open', current: null, aiPending: false, dismissable: false,
  options: ids.map((x, i) => ({ id: x, label: `Label ${x}`, recommended: i === 0, action: { kind: 'open', path: '/' } })) });

test('the AI answers with an index; its option id comes back', async () => {
  const generate = async () => ({ pick: 1 });
  expect(await aiPick(row('goal.metric', ['a', 'b']), { projectDescription: 'We sell shoes' }, generate)).toBe('b');
});

test('an out-of-range index, a bad shape or a throw gives null', async () => {
  expect(await aiPick(row('goal.metric', ['a', 'b']), { projectDescription: null }, async () => ({ pick: 5 }))).toBeNull();
  expect(await aiPick(row('goal.metric', ['a', 'b']), { projectDescription: null }, async () => ({ nope: 1 }))).toBeNull();
  expect(await aiPick(row('goal.metric', ['a', 'b']), { projectDescription: null }, async () => { throw new Error('x'); })).toBeNull();
});

test('a single option needs no AI call', async () => {
  let called = false;
  expect(await aiPick(row('goal.metric', ['a']), { projectDescription: null }, async () => { called = true; return { pick: 0 }; })).toBe('a');
  expect(called).toBe(false);
});

test('the prompt asks for no Markdown and only the given facts', async () => {
  let prompt = '';
  await aiPick(row('goal.metric', ['a', 'b']), { projectDescription: 'x' }, async (p) => { prompt = p; return { pick: 0 }; });
  expect(prompt).toMatch(/only the facts/i);
  expect(prompt).toMatch(/no markdown/i);
});

test('only semantic rows go to the AI', () => {
  expect(AI_ROWS.test('goal.metric')).toBe(true);
  expect(AI_ROWS.test('team:c1.plan')).toBe(true);
  expect(AI_ROWS.test('goal.date')).toBe(false);
  expect(AI_ROWS.test('class:x.key')).toBe(false);
});

test('the facts hash changes with a field, not with the order of Data Marts', () => {
  const g = (fields: string[], order: string[]) => ({ inputs: { projectDescription: 'd', contexts: [], contextsOk: true, marts: [] }, failed: new Map(),
    nodes: order.map((id) => ({ id, title: id, contexts: [], detail: { id, title: id, fields: fields.map((name) => ({ name, type: 'NUMERIC', isPrimaryKey: false })) }, blendable: { availableSources: [], mainUniqueCountKeyFields: [] } })) }) as never;
  expect(factsHash(g(['a'], ['x', 'y']))).toBe(factsHash(g(['a'], ['y', 'x'])));
  expect(factsHash(g(['a'], ['x']))).not.toBe(factsHash(g(['b'], ['x'])));
});
