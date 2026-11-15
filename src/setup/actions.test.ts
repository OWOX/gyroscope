import { expect, test } from 'vitest';
import { runAction } from './actions';
import { memoryCollections } from '../store/collections';
import { EMPTY_SETUP, saveSetup } from '../store/settings';

const deps = (over: object = {}) => {
  const calls: unknown[] = [];
  const owox = {
    getJson: async (p: string) => (p === '/api/contexts' ? [{ id: 'c9', name: 'Marketing', description: null }] : { contexts: [] }),
    postJson: async (p: string, b: unknown) => { calls.push(['post', p, b]); return {}; },
    putJson: async (p: string, b: unknown) => { calls.push(['put', p, b]); return {}; },
    project: { getSettings: async () => ({ description: 'We sell shoes.' }), updateDescription: async (d: string | null) => { calls.push(['desc', d]); } },
    dataMarts: { list: async () => [], traverseData: async () => ({ rowChunks: async function* () {} }) },
  };
  return { calls, d: { owox: owox as never, store: memoryCollections(), settings: EMPTY_SETUP, by: 'Ann', now: () => new Date('2026-11-14T10:00:00Z'), open: (p: string) => calls.push(['open', p]), ...over } };
};

test('set saves the next settings', async () => {
  const { d } = deps();
  const r = await runAction({ kind: 'set', next: (s) => ({ ...s, thresholdPct: 25 }) }, d);
  expect(r).toMatchObject({ ok: true, settings: { thresholdPct: 25, updatedBy: 'Ann' } });
});

test('set from a stale base reports the conflict', async () => {
  const { d } = deps();
  await saveSetup(d.store, EMPTY_SETUP, { ...EMPTY_SETUP, thresholdPct: 30 }, 'Bob', new Date());
  const r = await runAction({ kind: 'set', next: (s) => s }, d);
  expect(r).toMatchObject({ ok: false, conflict: { by: 'Bob' } });
});

test('append reads the description now and adds the text after a blank line', async () => {
  const { d, calls } = deps();
  await runAction({ kind: 'append', scope: 'project', text: '| Role |' }, d);
  expect(calls).toContainEqual(['desc', 'We sell shoes.\n\n| Role |']);
});

test('teams creates each context and adds its Data Marts', async () => {
  const { d, calls } = deps();
  await runAction({ kind: 'teams', teams: [{ name: 'Marketing', martIds: ['ads'] }] }, d);
  expect(calls).toContainEqual(['post', '/api/contexts', { name: 'Marketing', description: '' }]);
  expect(calls.some((c) => (c as unknown[])[0] === 'put' && String((c as unknown[])[1]).includes('ads'))).toBe(true);
});

test('open goes to the page', async () => {
  const { d, calls } = deps();
  await runAction({ kind: 'open', path: '/ui/p1/plugins' }, d);
  expect(calls).toContainEqual(['open', '/ui/p1/plugins']);
});

test('a refused write returns the snippet', async () => {
  const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
  const { d } = deps();
  const owox = { ...(d.owox as object), project: { getSettings: async () => ({ description: 'x' }), updateDescription: async () => { throw forbidden; } } } as never;
  expect(await runAction({ kind: 'append', scope: 'project', text: 'P' }, { ...d, owox })).toEqual({ ok: false, error: 'OWOX refused the write', snippet: 'P' });
  const noPost = { ...(d.owox as object), postJson: undefined } as never;
  expect(await runAction({ kind: 'teams', teams: [{ name: 'A', martIds: [] }, { name: 'B', martIds: [] }] }, { ...d, owox: noPost })).toEqual({ ok: false, error: 'OWOX refused the write', snippet: 'A\nB' });
});
