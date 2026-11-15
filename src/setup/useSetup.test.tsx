import { act, renderHook, waitFor } from '@testing-library/react';
import { useSetup } from './useSetup';
import { memoryCollections } from '../store/collections';
import { loadSetup, loadSuggestions } from '../store/settings';
import { fakeOwox } from '../owox/fake';

const owox = () => fakeOwox({
  projectDescription: 'We sell shoes', contexts: [],
  marts: [{ id: 'orders', title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' }],
  details: { orders: { id: 'orders', title: 'Orders', fields: [{ name: 'order_id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'NUMERIC', isPrimaryKey: false }] } },
  blendables: { orders: { availableSources: [], mainUniqueCountKeyFields: ['order_id'] } },
  rows: () => [],
});

test('a new project is blocked; accepting the recommended critical number derives a model', async () => {
  const onModel = vi.fn();
  const { result } = renderHook(() => useSetup({ owox: owox(), store: memoryCollections(), generateWith: null, isAdmin: true, by: 'Ann', projectId: 'p1', now: () => new Date('2026-11-14T10:00:00Z'), open: vi.fn(), onModel }));
  await act(() => result.current.reload());
  expect(onModel.mock.calls.at(-1)![0]).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
  const rowMetric = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  await act(async () => result.current.props.onChoose('goal.metric', rowMetric.options.find((o) => o.recommended)!.id));
  await waitFor(() => expect(onModel.mock.calls.at(-1)![0]).toMatchObject({ ok: true }));
});

test('a member never calls the AI', async () => {
  const generateWith = vi.fn(async () => ({ pick: 0 }));
  const { result } = renderHook(() => useSetup({ owox: owox(), store: memoryCollections(), generateWith, isAdmin: false, by: 'Bob', projectId: 'p1', now: () => new Date(), open: vi.fn(), onModel: vi.fn() }));
  await act(() => result.current.reload());
  expect(generateWith).not.toHaveBeenCalled();
});

test('an admin with AI caches the picks under the facts hash and does not ask again', async () => {
  const store = memoryCollections();
  const generateWith = vi.fn(async () => ({ pick: 0 }));
  const args = { owox: owox(), store, generateWith, isAdmin: true, by: 'Ann', projectId: 'p1', now: () => new Date(), open: vi.fn(), onModel: vi.fn() };
  const first = renderHook(() => useSetup(args));
  await act(() => first.result.current.reload());
  await waitFor(() => expect(first.result.current.props.rows.every((r) => !r.aiPending)).toBe(true));
  const calls = generateWith.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
  const second = renderHook(() => useSetup(args));
  await act(() => second.result.current.reload());
  expect(generateWith.mock.calls.length).toBe(calls);
});

test('a conflicting save says who changed setup and reloads', async () => {
  const store = memoryCollections();
  const args = { owox: owox(), store, generateWith: null, isAdmin: true, by: 'Ann', projectId: 'p1', now: () => new Date('2026-11-14T10:00:00Z'), open: vi.fn(), onModel: vi.fn() };
  const { result } = renderHook(() => useSetup(args));
  await act(() => result.current.reload());
  const { saveSetup, loadSetup } = await import('../store/settings');
  const base = (await loadSetup(store)).settings;
  await saveSetup(store, base, { ...base, thresholdPct: 30 }, 'Bob', new Date('2026-11-14T09:05:00Z'));
  const row = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  await act(async () => result.current.props.onChoose('goal.metric', row.options.find((o) => o.recommended)!.id));
  await waitFor(() => expect(result.current.props.message).toMatch(/^Bob changed setup at \d\d:\d\d\. Reloaded\.$/));
  expect(result.current.settings!.thresholdPct).toBe(30);
});

const adminArgs = (store: ReturnType<typeof memoryCollections>, generateWith: (p: string, s: unknown) => Promise<unknown>, over: Record<string, unknown> = {}) =>
  ({ owox: owox(), store, generateWith: generateWith as never, isAdmin: true, by: 'Ann', projectId: 'p1', now: () => new Date('2026-11-14T10:00:00Z'), open: vi.fn(), onModel: vi.fn(), ...over });
const items = async (store: ReturnType<typeof memoryCollections>) => (await loadSuggestions(store))?.items ?? {};

const twoMarts = () => fakeOwox({
  projectDescription: 'We sell shoes', contexts: [],
  marts: [{ id: 'orders', title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' }, { id: 'ads', title: 'Ads', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' }],
  details: {
    orders: { id: 'orders', title: 'Orders', fields: [{ name: 'order_id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'NUMERIC', isPrimaryKey: false }, { name: 'revenue_plan', type: 'NUMERIC', isPrimaryKey: false }, { name: 'items', type: 'INTEGER', isPrimaryKey: false }] },
    ads: { id: 'ads', title: 'Ads', fields: [{ name: 'ad_id', type: 'STRING', isPrimaryKey: true }, { name: 'created', type: 'DATE', isPrimaryKey: false }, { name: 'cost', type: 'NUMERIC', isPrimaryKey: false }, { name: 'budget_target', type: 'NUMERIC', isPrimaryKey: false }] },
  },
  blendables: { orders: { availableSources: [], mainUniqueCountKeyFields: ['order_id'] }, ads: { availableSources: [], mainUniqueCountKeyFields: ['ad_id'] } },
  rows: () => [],
});

test('rows whose options change after a choice get an AI pick', async () => {
  const store = memoryCollections();
  const generateWith = vi.fn(async () => ({ pick: 0 }));
  const { result } = renderHook(() => useSetup(adminArgs(store, generateWith, { owox: twoMarts() })));
  await act(() => result.current.reload());
  await waitFor(() => expect(result.current.props.rows.every((r) => !r.aiPending)).toBe(true));
  const metric = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  await act(async () => result.current.props.onChoose('goal.metric', metric.options.find((o) => o.recommended)!.id));
  const shown = () => result.current.props.rows.find((r) => /^class:.*\.shown$/.test(r.id) && r.options.some((o) => o.id.startsWith('shown:') && o.id !== 'shown:none'));
  await waitFor(() => expect(shown()).toBeDefined());
  const before = Object.keys(await items(store)).filter((k) => k.startsWith('metric:'));
  await act(async () => result.current.props.onChoose(shown()!.id, shown()!.options.find((o) => o.id !== 'shown:none')!.id));
  // the metric plan rows appear with the shown numbers and are asked, though the facts hash did not change
  await waitFor(async () => expect(Object.keys(await items(store)).filter((k) => k.startsWith('metric:')).length).toBeGreaterThan(before.length));
});

test('a cached doc missing one row is asked for that row only', async () => {
  const store = memoryCollections();
  const generateWith = vi.fn(async () => ({ pick: 0 }));
  const first = renderHook(() => useSetup(adminArgs(store, generateWith)));
  await act(() => first.result.current.reload());
  await waitFor(async () => expect(Object.keys(await items(store)).length).toBeGreaterThan(0));
  await waitFor(() => expect(first.result.current.props.rows.every((r) => !r.aiPending)).toBe(true));
  const doc = (await loadSuggestions(store))!;
  const [dropped, ...rest] = Object.keys(doc.items);
  await store.collections('suggestions').put('current', { ...doc, items: Object.fromEntries(rest.map((k) => [k, doc.items[k]!])) });
  generateWith.mockClear();
  const second = renderHook(() => useSetup(adminArgs(store, generateWith)));
  await act(() => second.result.current.reload());
  await waitFor(async () => expect(Object.keys(await items(store))).toContain(dropped));
  expect(generateWith.mock.calls.length).toBeLessThanOrEqual(1);
  expect(Object.keys(await items(store)).length).toBe(Object.keys(doc.items).length);
});

test('a cached pick whose options changed is ignored and asked again', async () => {
  const store = memoryCollections();
  const { loadGraph } = await import('../model/graph-load');
  const { factsHash } = await import('./ai');
  const hash = factsHash(await loadGraph(owox()));
  await store.collections('suggestions').put('current', { inputHash: hash, at: 'x', items: { 'goal.metric#00000000': 'not-an-option' } });
  const generateWith = vi.fn(async () => ({ pick: 0 }));
  const { result } = renderHook(() => useSetup(adminArgs(store, generateWith)));
  await act(() => result.current.reload());
  await waitFor(() => expect(generateWith).toHaveBeenCalled());
  expect(result.current.props.rows.find((r) => r.id === 'goal.metric')!.options.some((o) => o.id === 'not-an-option')).toBe(false);
});

test('a member cannot choose or dismiss', async () => {
  const store = memoryCollections();
  const onModel = vi.fn();
  const { result } = renderHook(() => useSetup(adminArgs(store, async () => ({ pick: 0 }), { isAdmin: false, onModel })));
  await act(() => result.current.reload());
  onModel.mockClear();
  const row = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  await act(async () => { result.current.props.onChoose('goal.metric', row.options[0]!.id); result.current.props.onDismiss('goal.metric'); });
  expect(onModel).not.toHaveBeenCalled();
  expect((await loadSetup(store)).settings.updatedAt).toBeNull();
});

test('a reload does not wait for the AI', async () => {
  const store = memoryCollections();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const generateWith = vi.fn(async () => { await gate; return { pick: 0 }; });
  const { result } = renderHook(() => useSetup(adminArgs(store, generateWith)));
  await act(() => result.current.reload());
  expect(result.current.props.loading).toBe(false);
  release();
});

test('an older AI run settling after a reload does not clear the newer run\'s pending rows', async () => {
  const store = memoryCollections();
  const gate = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
  const gates = [gate(), gate()];
  let phase = 0;
  const generateWith = vi.fn(async () => { await gates[phase]!.promise; return { pick: 0 }; });
  const { result } = renderHook(() => useSetup(adminArgs(store, generateWith)));
  await act(() => result.current.reload());
  await waitFor(() => expect(result.current.props.rows.some((r) => r.aiPending)).toBe(true));
  phase = 1;
  await act(() => result.current.reload());
  await waitFor(() => expect(result.current.props.rows.some((r) => r.aiPending)).toBe(true));
  await act(async () => { gates[0]!.resolve(); await Promise.resolve(); });
  await new Promise((r) => setTimeout(r, 20));
  expect(result.current.props.rows.some((r) => r.aiPending)).toBe(true);
  gates[1]!.resolve();
  await waitFor(() => expect(result.current.props.rows.every((r) => !r.aiPending)).toBe(true));
});
