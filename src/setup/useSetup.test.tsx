import { act, renderHook, waitFor } from '@testing-library/react';
import { useSetup } from './useSetup';
import { memoryCollections } from '../store/collections';
import { loadSetup, loadSuggestions } from '../store/settings';
import { fakeOwox } from '../owox/fake';

const recOf = (r: { current: { props: { rows: { id: string; options: { id: string; recommended: boolean }[] }[] } } }, id: string) => r.current.props.rows.find((x) => x.id === id)!.options.find((o) => o.recommended)!.id;
const owox = () => fakeOwox({
  projectDescription: 'We sell shoes', contexts: [],
  marts: [{ id: 'orders', title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' }],
  details: { orders: { id: 'orders', title: 'Orders', fields: [{ name: 'order_id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'NUMERIC', isPrimaryKey: false }] } },
  blendables: { orders: { availableSources: [], mainUniqueCountKeyFields: ['order_id'] } },
  rows: () => [],
});

test('a new project is blocked; accepting the recommended critical number derives a model only after Save', async () => {
  const onModel = vi.fn();
  const store = memoryCollections();
  const { result } = renderHook(() => useSetup({ owox: owox(), store, generateWith: null, isAdmin: true, by: 'Ann', projectId: 'p1', now: () => new Date('2026-11-14T10:00:00Z'), open: vi.fn(), onModel }));
  await act(() => result.current.reload());
  expect(onModel.mock.calls.at(-1)![0]).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
  const rowMetric = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  const bar = () => result.current.props.rows.filter((r) => r.state === 'done').length;
  const before = bar();
  await act(async () => result.current.props.onPick('goal.metric', rowMetric.options.find((o) => o.recommended)!.id));
  expect(result.current.props.dirty).toBe(1);
  expect(result.current.props.picked).toEqual({ 'goal.metric': rowMetric.options.find((o) => o.recommended)!.id });
  // staged: the rows follow the draft, nothing is written and the canvas model is untouched
  expect(result.current.props.rows.find((r) => r.id === 'goal.metric')!.state).toBe('done');
  expect(bar()).toBeGreaterThan(before);
  expect(result.current.props.savedOpen.has('goal.metric')).toBe(true);
  expect(result.current.settings!.goal).toBeNull();
  expect(onModel).toHaveBeenCalledTimes(1);
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(onModel.mock.calls.at(-1)![0]).toMatchObject({ ok: true }));
  expect(result.current.props.dirty).toBe(0);
  expect(result.current.settings!.goal?.measure.field).toBe('revenue');
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

test('a conflicting Save says who changed setup, reloads and keeps the picks', async () => {
  const store = memoryCollections();
  const args = { owox: owox(), store, generateWith: null, isAdmin: true, by: 'Ann', projectId: 'p1', now: () => new Date('2026-11-14T10:00:00Z'), open: vi.fn(), onModel: vi.fn() };
  const { result } = renderHook(() => useSetup(args));
  await act(() => result.current.reload());
  const { saveSetup, loadSetup } = await import('../store/settings');
  const base = (await loadSetup(store)).settings;
  await saveSetup(store, base, { ...base, thresholdPct: 30 }, 'Bob', new Date('2026-11-14T09:05:00Z'));
  const row = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  await act(async () => result.current.props.onPick('goal.metric', row.options.find((o) => o.recommended)!.id));
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(result.current.props.message).toMatch(/^Bob changed setup at \d\d:\d\d\. Reloaded\.$/));
  expect(result.current.settings!.thresholdPct).toBe(30);
  // the picks stay, and a second Save replays them on the newly saved settings
  expect(result.current.props.dirty).toBe(1);
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(result.current.props.dirty).toBe(0));
  expect(result.current.props.message).toBeNull();
  expect(result.current.settings).toMatchObject({ thresholdPct: 30, goal: { measure: { field: 'revenue' } } });
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
  await act(async () => result.current.props.onPick('goal.metric', metric.options.find((o) => o.recommended)!.id));
  const shown = () => result.current.props.rows.find((r) => /^class:.*\.shown$/.test(r.id) && r.options.some((o) => o.id.startsWith('shown:') && o.id !== 'shown:none'));
  await waitFor(() => expect(shown()).toBeDefined());
  const before = Object.keys(await items(store)).filter((k) => k.startsWith('metric:'));
  await act(async () => result.current.props.onPick(shown()!.id, shown()!.options.find((o) => o.id !== 'shown:none')!.id));
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

test('a member cannot stage or save', async () => {
  const store = memoryCollections();
  const onModel = vi.fn();
  const { result } = renderHook(() => useSetup(adminArgs(store, async () => ({ pick: 0 }), { isAdmin: false, onModel })));
  await act(() => result.current.reload());
  onModel.mockClear();
  const row = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  await act(async () => { result.current.props.onPick('goal.metric', row.options[0]!.id); result.current.props.onSave(); });
  expect(result.current.props.dirty).toBe(0);
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

test('picks stage in order, a re-pick keeps its place, and null removes it; Discard clears', async () => {
  const store = memoryCollections();
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null })));
  await act(() => result.current.reload());
  const opts = result.current.props.rows.find((r) => r.id === 'goal.metric')!.options;
  await act(async () => result.current.props.onPick('goal.metric', opts[0]!.id));
  await act(async () => result.current.props.onPick('goal.date', recOf(result, 'goal.date')));
  expect(Object.keys(result.current.props.picked)).toEqual(['goal.metric', 'goal.date']);
  await act(async () => result.current.props.onPick('goal.metric', opts.at(-1)!.id));
  expect(Object.keys(result.current.props.picked)).toEqual(['goal.metric', 'goal.date']);
  expect(result.current.props.dirty).toBe(2);
  await act(async () => result.current.props.onPick('goal.date', null));
  expect(result.current.props.dirty).toBe(1);
  await act(async () => result.current.props.onDiscard());
  expect(result.current.props.dirty).toBe(0);
  expect((await loadSetup(store)).settings.updatedAt).toBeNull();
});

test('two staged choices land in one Save, with one write', async () => {
  const store = memoryCollections();
  const put = vi.fn();
  const orig = store.collections.bind(store);
  store.collections = ((name: string) => { const c = orig(name as never) as { put: (...a: unknown[]) => unknown }; if (name !== 'settings') return c; const p = c.put.bind(c); return { ...c, put: (...a: unknown[]) => { put(); return p(...a); } }; }) as never;
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null })));
  await act(() => result.current.reload());
  await act(async () => { result.current.props.onPick('goal.metric', recOf(result, 'goal.metric')); });
  await act(async () => { result.current.props.onPick('goal.date', recOf(result, 'goal.date')); });
  expect(put).not.toHaveBeenCalled();
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(result.current.settings?.goal?.dateField).toBe('date'));
  expect(result.current.settings!.goal!.measure.field).toBe('revenue');
  expect(result.current.props.message).toBeNull();
  expect((await loadSetup(store)).settings.goal?.dateField).toBe('date');
  expect(put).toHaveBeenCalledTimes(1);
});

test('Save runs a staged append after the settings write, and Save with nothing staged does nothing', async () => {
  const store = memoryCollections();
  const source = owox();
  const updateDescription = vi.fn(async () => {});
  source.project.updateDescription = updateDescription;
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null, owox: source })));
  await act(() => result.current.reload());
  await act(async () => result.current.props.onSave());
  expect(updateDescription).not.toHaveBeenCalled();
  await act(async () => result.current.props.onPick('goal.metric', recOf(result, 'goal.metric')));
  const desc = result.current.props.rows.find((r) => r.id === 'goal.description')!;
  expect(desc.options[0]!.action.kind).toBe('append');
  await act(async () => result.current.props.onPick('goal.description', desc.options[0]!.id));
  expect(result.current.props.dirty).toBe(2);
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(result.current.props.dirty).toBe(0));
  expect(updateDescription).toHaveBeenCalledTimes(1);
  expect(String((updateDescription.mock.calls[0] as unknown[])[0])).toContain('Orders · revenue');
  expect((await loadSetup(store)).settings.goal?.measure.field).toBe('revenue');
});

const twoMartsPlan = () => twoMarts();

test('an append picked before the metric changes is written with the final metric', async () => {
  const store = memoryCollections();
  const source = twoMarts();
  const updateDescription = vi.fn(async (_: string) => {});
  source.project.updateDescription = updateDescription;
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null, owox: source })));
  await act(() => result.current.reload());
  const metric = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  const [first, second] = metric.options.filter((o) => o.id.startsWith('field:')).map((o) => o.id);
  await act(async () => result.current.props.onPick('goal.metric', first!));
  const desc = () => result.current.props.rows.find((r) => r.id === 'goal.description')!;
  await act(async () => result.current.props.onPick('goal.description', desc().options[0]!.id));
  await act(async () => result.current.props.onPick('goal.metric', second!));
  expect(Object.keys(result.current.props.picked)).toEqual(['goal.metric', 'goal.description']);
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(updateDescription).toHaveBeenCalled());
  const field = second!.split(':')[2]!;
  expect(updateDescription.mock.calls[0]![0]).toContain(`field=${field}`);
  expect(updateDescription.mock.calls[0]![0]).not.toContain(`field=${first!.split(':')[2]}`);
});

test('re-picking the metric keeps a plan picked after it', async () => {
  const store = memoryCollections();
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null, owox: twoMartsPlan() })));
  await act(() => result.current.reload());
  const metric = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  const orders = metric.options.filter((o) => o.id.startsWith('field:orders:')).map((o) => o.id);
  await act(async () => result.current.props.onPick('goal.metric', orders[0]!));
  const plan = result.current.props.rows.find((r) => r.id === 'goal.plan')!.options.find((o) => o.id === 'field:orders:revenue_plan')!;
  await act(async () => result.current.props.onPick('goal.plan', plan.id));
  await act(async () => result.current.props.onPick('goal.metric', orders.at(-1)!));
  expect(result.current.props.picked['goal.plan']).toBe(plan.id);
  expect(result.current.props.rows.find((r) => r.id === 'goal.plan')!.state).toBe('done');
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(result.current.props.dirty).toBe(0));
  expect(result.current.settings!.goal!.plan?.measure.field).toBe('revenue_plan');
});

test('a stale pick is dropped from the visible picks and the save', async () => {
  const store = memoryCollections();
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null, owox: twoMarts() })));
  await act(() => result.current.reload());
  const metric = result.current.props.rows.find((r) => r.id === 'goal.metric')!;
  const orders = metric.options.filter((o) => o.id.startsWith('field:orders:')).map((o) => o.id);
  await act(async () => result.current.props.onPick('goal.metric', orders[0]!));
  const plan = result.current.props.rows.find((r) => r.id === 'goal.plan')!.options.find((o) => o.id === 'field:orders:revenue_plan')!;
  await act(async () => result.current.props.onPick('goal.plan', plan.id));
  // the goal moves to another Data Mart: the plan option for Orders is no longer on offer there only if it vanished
  const ads = metric.options.find((o) => o.id.startsWith('field:ads:'))!;
  await act(async () => result.current.props.onPick('goal.metric', ads.id));
  const stale = !result.current.props.rows.find((r) => r.id === 'goal.plan')!.options.some((o) => o.id === plan.id);
  expect(Object.keys(result.current.props.picked).includes('goal.plan')).toBe(!stale);
  expect(result.current.props.dirty).toBe(Object.keys(result.current.props.picked).length);
});

test('a partial failure keeps the append staged and drops the written settings pick', async () => {
  const store = memoryCollections();
  const source = owox();
  source.project.updateDescription = vi.fn(async () => { throw new Error('boom'); });
  const { result } = renderHook(() => useSetup(adminArgs(store, vi.fn() as never, { generateWith: null, owox: source })));
  await act(() => result.current.reload());
  await act(async () => result.current.props.onPick('goal.metric', recOf(result, 'goal.metric')));
  const desc = result.current.props.rows.find((r) => r.id === 'goal.description')!;
  await act(async () => result.current.props.onPick('goal.description', desc.options[0]!.id));
  await act(async () => result.current.props.onSave());
  await waitFor(() => expect(result.current.props.message).toMatch(/boom/));
  await waitFor(() => expect(result.current.props.saving).toBe(false));
  expect(Object.keys(result.current.props.picked)).toEqual(['goal.description']);
  expect((await loadSetup(store)).settings.goal?.measure.field).toBe('revenue');
});
