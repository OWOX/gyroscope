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
  let made = false;
  const base = d.owox as unknown as { postJson: (p: string, b: unknown) => Promise<unknown> };
  const owox = { ...base, getJson: async (p: string) => (p === '/api/contexts' ? (made ? [{ id: 's1', name: 'Sales', description: null }] : []) : { contexts: [] }), postJson: async (p: string, b: unknown) => { made = true; return base.postJson(p, b); } } as never;
  await runAction({ kind: 'teams', teams: [{ name: 'Sales', martIds: ['ads'] }] }, { ...d, owox });
  expect(calls).toContainEqual(['post', '/api/contexts', { name: 'Sales', description: '' }]);
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

test('teams reuses an existing context by name, case-insensitively, without a POST', async () => {
  const { d, calls } = deps();
  const r = await runAction({ kind: 'teams', teams: [{ name: 'marketing', martIds: ['ads'] }] }, d);
  expect(r.ok).toBe(true);
  expect(calls.some((c) => (c as unknown[])[0] === 'post')).toBe(false);
  expect(calls).toContainEqual(['put', '/api/data-marts/ads/contexts', { contextIds: ['c9'] }]);
});

test('teams takes the new context id from the POST response without another GET', async () => {
  const { d, calls } = deps();
  let ctxGets = 0;
  const base = d.owox as unknown as { getJson: (p: string) => Promise<unknown> };
  const owox = { ...base, getJson: async (p: string) => { if (p === '/api/contexts') ctxGets++; return p === '/api/contexts' ? [] : { contexts: [] }; }, postJson: async () => ({ id: 'n1' }), putJson: async (p: string, b: unknown) => { calls.push(['put', p, b]); return {}; } } as never;
  await runAction({ kind: 'teams', teams: [{ name: 'Sales', martIds: ['ads'] }] }, { ...d, owox });
  expect(ctxGets).toBe(1);
  expect(calls).toContainEqual(['put', '/api/data-marts/ads/contexts', { contextIds: ['n1'] }]);
});

test('a 403 on the context PUT inside teams is a refusal', async () => {
  const { d } = deps();
  const owox = { ...(d.owox as object), putJson: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } } as never;
  expect(await runAction({ kind: 'teams', teams: [{ name: 'Marketing', martIds: ['ads'] }] }, { ...d, owox })).toEqual({ ok: false, error: 'OWOX refused the write', snippet: 'Marketing' });
});

test('another error returns its message without a snippet', async () => {
  const { d } = deps();
  const owox = { ...(d.owox as object), project: { getSettings: async () => ({ description: 'x' }), updateDescription: async () => { throw new Error('boom'); } } } as never;
  expect(await runAction({ kind: 'append', scope: 'project', text: 'P' }, { ...d, owox })).toEqual({ ok: false, error: 'boom' });
});

test('teams adds the contexts it makes to a saved needle list with a live id, and leaves an unset list alone', async () => {
  const { d } = deps();
  const base = d.owox as unknown as { postJson: (p: string, b: unknown) => Promise<unknown> };
  const owox = { ...base, postJson: async () => ({ id: 's1' }) } as never;
  const saved = await saveSetup(d.store, EMPTY_SETUP, { ...EMPTY_SETUP, needleContexts: ['c9'] }, 'Ann', new Date());
  const team = [{ name: 'Sales', martIds: ['ads'] }];
  const r = await runAction({ kind: 'teams', teams: team }, { ...d, owox, settings: saved });
  expect(r).toMatchObject({ ok: true, settings: { needleContexts: ['c9', 's1'] } });
  // a reused context that is already in the list is not added twice
  const again = await runAction({ kind: 'teams', teams: [{ name: 'Marketing', martIds: ['ads'] }] }, { ...d, settings: (r as { settings: typeof saved }).settings });
  expect(again).toMatchObject({ ok: true, settings: { needleContexts: ['c9', 's1'] } });
  const all = await runAction({ kind: 'teams', teams: team }, { ...d, owox });
  expect(all).toMatchObject({ ok: true, settings: { needleContexts: null } });
});

test('teams clears a saved needle list none of whose ids exist, so every context keeps counting', async () => {
  const { d } = deps();
  const saved = await saveSetup(d.store, EMPTY_SETUP, { ...EMPTY_SETUP, needleContexts: ['old'] }, 'Ann', new Date());
  const r = await runAction({ kind: 'teams', teams: [{ name: 'Marketing', martIds: ['ads'] }] }, { ...d, settings: saved });
  expect(r).toMatchObject({ ok: true, settings: { needleContexts: null } });
});

test('teams appends the new context to an empty needle list (none), which stays a list', async () => {
  const { d } = deps();
  const base = d.owox as unknown as { postJson: (p: string, b: unknown) => Promise<unknown> };
  const owox = { ...base, postJson: async () => ({ id: 's1' }) } as never;
  const saved = await saveSetup(d.store, EMPTY_SETUP, { ...EMPTY_SETUP, needleContexts: [] }, 'Ann', new Date());
  const r = await runAction({ kind: 'teams', teams: [{ name: 'Sales', martIds: ['ads'] }] }, { ...d, owox, settings: saved });
  expect(r).toMatchObject({ ok: true, settings: { needleContexts: ['s1'] } });
});
