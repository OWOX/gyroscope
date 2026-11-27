import { warmCache, ActionError } from './warm';
import { cachedOwox } from '../src/cache/martCache';
import { resolveRange } from '../src/lib/dates';
import { cacheKey, refreshCanvas } from '../src/metrics/refresh';
import { deriveModel } from '../src/model/derive';
import { loadGraph } from '../src/model/graph-load';
import type { OwoxLike } from '../src/owox/sources';
import { memoryCollections } from '../src/store/collections';
import { EMPTY_SETUP, loadSetup, saveSetup } from '../src/store/settings';
import { MART_CACHE, type MartCacheDoc } from '../src/cache/martCache';
import { fakeOwox, type FakeOwoxData } from '../src/owox/fake';

const data: FakeOwoxData = {
  projectDescription: null,
  contexts: [],
  marts: ['a', 'b'].map((id) => ({ id, title: id, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' })),
  details: {
    a: { id: 'a', title: 'Revenue', fields: [
      { name: 'id', type: 'STRING', isPrimaryKey: true },
      { name: 'date', type: 'DATE', isPrimaryKey: false },
      { name: 'revenue', type: 'FLOAT', isPrimaryKey: false },
    ] },
    b: { id: 'b', title: 'Plan', fields: [
      { name: 'date', type: 'DATE', isPrimaryKey: false },
      { name: 'target', type: 'FLOAT', isPrimaryKey: false },
    ] },
  },
  blendables: {
    a: { availableSources: [], mainUniqueCountKeyFields: ['id'] },
    b: { availableSources: [], mainUniqueCountKeyFields: [] },
  },
  rows: () => [{ 'revenue | SUM': 5, 'target | SUM': 8, date: '2026-11-05' }],
};
const owox = fakeOwox(data);

const NOW = new Date('2026-11-06T08:00:00Z');
const range = (preset: string, weekStart = 'monday') => ({ range: { kind: 'preset', preset }, compare: { kind: 'off' }, weekStart });

async function setup(withPlan = false) {
  const store = memoryCollections();
  await saveSetup(store, EMPTY_SETUP, {
    ...EMPTY_SETUP,
    goal: {
      martId: 'a', measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', kind: 'flow', alias: 'Revenue',
      plan: withPlan ? { martId: 'b', measure: { field: 'target', fn: 'SUM' }, dateField: 'date', shape: 'daily' } : null,
    },
  }, 'Ann', NOW);
  return store;
}
const ctxOf = (store: ReturnType<typeof memoryCollections>, deadline = '2026-11-06T08:05:00Z', o: OwoxLike = owox) =>
  ({ owox: o, collections: store.collections.bind(store), execution: { deadlineAt: deadline } });
const warm = (store: ReturnType<typeof memoryCollections>, ranges: unknown[], deadline?: string, o?: OwoxLike, now: () => Date = () => NOW) =>
  warmCache({ ranges }, ctxOf(store, deadline, o), now);

test('a run writes one cache doc per Data Mart and range', async () => {
  const store = await setup();
  const r = await warm(store, [range('qtd'), range('last_month')]);
  expect(r.ranges).toBe(2);
  expect(r.skipped).toBe(0);
  expect(r.queries).toBeGreaterThan(0);
  const docs = store.collections<MartCacheDoc>(MART_CACHE);
  expect((await docs.get('a:qtd:off'))?.document.anchor).toBe('2026-11-05'); // the anchor is the last complete day
  expect(await docs.get('a:last_month:off')).not.toBeNull();
});

test('an invalid input fails with INVALID_RANGES', async () => {
  await expect(warm(await setup(), [])).rejects.toMatchObject({ code: 'INVALID_RANGES' });
});

test('missing project Setup fails with MODEL_MISSING', async () => {
  const err = warm(memoryCollections(), [range('qtd')]);
  await expect(err).rejects.toBeInstanceOf(ActionError);
  await expect(err).rejects.toMatchObject({ code: 'MODEL_MISSING', message: 'Finish Setup in Gyroscope before running a schedule. The Business Critical Number is not set.' });
});

test('with under 30 seconds left no new range starts', async () => {
  expect(await warm(await setup(), [range('qtd'), range('mtd')], '2026-11-06T08:00:20Z')).toMatchObject({ ranges: 0, skipped: 2 });
});

test('an unparseable deadline still keeps the 30 second reserve', async () => {
  // with a NaN deadline both ranges would run; the clock jumps 200 s per read, so the fallback deadline must cut the second one
  let t = NOW.getTime();
  const r = await warm(await setup(), [range('qtd'), range('mtd')], 'not a date', undefined, () => { const d = new Date(t); t += 200_000; return d; });
  expect(r.ranges).toBe(1);
  expect(r.skipped).toBe(1);
});

test('nothing written while writes failed or were too large fails with CACHE_NOT_WRITTEN', async () => {
  const store = await setup();
  const failing = { ...store, collections: <T,>(name: string) => {
    const col = store.collections<T>(name);
    return name === 'mart-cache' ? { ...col, put: async () => { throw new Error('boom'); } } : col;
  } };
  await expect(warmCache({ ranges: [range('qtd')] }, { owox, collections: failing.collections as never, execution: { deadlineAt: '2026-11-06T08:05:00Z' } }, () => NOW))
    .rejects.toMatchObject({ code: 'CACHE_NOT_WRITTEN' });
});

test('nothing written because the owner cannot edit the Data Marts fails with CACHE_ACCESS_DENIED', async () => {
  const store = await setup();
  const viewer = { ...store, collections: <T,>(name: string) => {
    const col = store.collections<T>(name);
    return name === 'mart-cache' ? { ...col, put: async () => { throw Object.assign(new Error('forbidden'), { payload: { status: 403 } }); } } : col;
  } };
  await expect(warmCache({ ranges: [range('qtd')] }, { owox, collections: viewer.collections as never, execution: { deadlineAt: '2026-11-06T08:05:00Z' } }, () => NOW))
    .rejects.toMatchObject({ code: 'CACHE_ACCESS_DENIED', message: expect.stringContaining('cannot edit') });
});

test('a run whose Data Marts return no query fails with NO_DATA', async () => {
  const denied = fakeOwox({ ...data, rows: () => { throw new Error('403'); } });
  await expect(warm(await setup(), [range('qtd')], undefined, denied)).rejects.toMatchObject({ code: 'NO_DATA', message: expect.stringContaining('may not be able to read') });
});

test.each([['qtd', 'monday'], ['wtd', 'sunday']])('the page answers from what the schedule cached (%s, week from %s), plan Data Mart included', async (preset, weekStart) => {
  const store = await setup(true);
  const worker = fakeOwox(data);
  const r = range(preset, weekStart);
  await warm(store, [r], undefined, worker);
  expect(worker.calls.some((c) => c.path === 'traverse:b')).toBe(true);

  // the page derives the model from the saved Setup and current Data Mart schemas
  const page = fakeOwox(data);
  const graph = await loadGraph(page);
  const { settings } = await loadSetup(store);
  const derived = deriveModel(settings, graph);
  if (!derived.ok) throw new Error(derived.blocked.detail);
  const visibleIds = new Set(graph.inputs.marts.map((mart) => mart.id));
  const details = new Map(graph.nodes.map((node) => [node.id, node.detail]));
  const spec = resolveRange(r.range as never, r.compare as never, NOW, weekStart as never);
  const key = cacheKey(r.range as never, r.compare as never, weekStart as never);
  const src = cachedOwox({ owox: page as OwoxLike, store, key, anchor: spec.anchor, mode: 'read-write', now: () => NOW });
  await refreshCanvas({ owox: src.owox, model: derived.model, spec, key, thresholdPct: settings.thresholdPct, visibleIds, details });
  expect(page.calls.filter((c) => c.path.startsWith('traverse:'))).toHaveLength(0);
  expect(src.stats().hits).toBeGreaterThan(0);
});

test('a schedule skips a plan Data Mart the member cannot see', async () => {
  const member = fakeOwox({ ...data, marts: data.marts.filter((mart) => mart.id !== 'b') });
  const result = await warm(await setup(true), [range('qtd')], undefined, member);
  expect(result.marts).toBe(1);
  expect(member.calls.some((call) => call.path === 'traverse:b')).toBe(false);
});
