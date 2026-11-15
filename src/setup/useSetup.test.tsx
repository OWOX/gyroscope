import { act, renderHook, waitFor } from '@testing-library/react';
import { useSetup } from './useSetup';
import { memoryCollections } from '../store/collections';
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
