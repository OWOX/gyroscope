import { cleanup, fireEvent, render, screen, waitFor, within } from './test-host';
import { App, type AppDeps } from './App';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { cacheKey } from './metrics/refresh';
import { loadPreferences, loadViewSettings, memoryCollections, savePreferences, saveViewSettings, type CollectionsLike } from './store/collections';
import { EMPTY_SETUP, saveSetup } from './store/settings';
import { type ProjectSettingsV5 } from './types';

const GID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-10-24T10:00:00Z');
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const CID = 'c';
const data = (): FakeOwoxData => ({
  projectDescription: null,
  contexts: [],
  marts: [mart(GID, 'Orders')],
  details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'FLOAT', alias: 'Revenue', isPrimaryKey: false }] } },
  blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});
/** The settings of a filled project: Revenue of Orders is the critical number. */
export const filled: ProjectSettingsV5 = { ...EMPTY_SETUP, goal: { martId: GID, measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', kind: 'flow', alias: 'Revenue', plan: null } };

async function setup(opts: { cache?: 'fresh' | 'stale' | 'none'; store?: CollectionsLike; withCustomers?: boolean; range?: 'qtd' | 'none' | 'unset'; roles?: string[] } = {}) {
  const d = data();
  if (opts.roles) d.roles = opts.roles;
  if (opts.withCustomers) {
    d.marts.push(mart(CID, 'Customers'));
    d.details[CID] = { id: CID, title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] };
    d.blendables[GID] = { availableSources: [{ aliasPath: 'customers', dataMartId: CID, title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] };
    d.blendables[CID] = { availableSources: [], mainUniqueCountKeyFields: ['id'] };
    d.details[GID]!.fields.push({ name: 'ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="x"}})', level: 'metric' } });
  }
  const owox = fakeOwox(d);
  const store = opts.store ?? memoryCollections();
  await saveSetup(store, EMPTY_SETUP, filled, 'Ann', NOW);
  const cache = opts.cache ?? 'fresh';
  const rangeOpt = opts.range ?? 'qtd';
  if (rangeOpt === 'qtd') await saveViewSettings(store, { defaultPreset: 'qtd', comparisonDefault: true, weekStart: 'monday' });
  let clock = NOW.getTime() - (cache === 'fresh' ? 3_600_000 : cache === 'stale' ? 86_400_000 : 0);
  const deps: AppDeps = { owox, store, userId: 'u1', now: () => new Date(clock) };
  const count = () => owox.calls.filter((c) => c.path.startsWith('traverse:')).length;
  if (cache !== 'none' && rangeOpt === 'qtd') {
    render(<App ctx={ctxWith().ctx} deps={deps} />);
    await screen.findByText(/Updated just now/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    cleanup();
  }
  clock = NOW.getTime();
  const baseline = count();
  const traversals = () => count() - baseline;
  const tick = () => { clock += 60_000; };
  return { deps, traversals, store, d, owox, tick };
}
const ctxWith = (setRoute = vi.fn()) => ({ ctx: { projectId: 'p', ui: { setRoute } } as never, setRoute });

test('a fresh cache renders at once without refreshing', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText(/Updated 1 h ago/)).toBeInTheDocument();
  expect(traversals()).toBe(0);
});

test('a Data Mart cache of another day answers nothing and queries again', async () => {
  const { deps, traversals } = await setup({ cache: 'stale' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
});


test('Settings and Back set the route', async () => {
  const { deps } = await setup();
  const { ctx, setRoute } = ctxWith();
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  expect(setRoute).toHaveBeenCalledWith('/settings');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(setRoute).toHaveBeenLastCalledWith('/');
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});

test('saving unchanged view settings does not refresh', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(/Updated 1 h ago/);
  expect(traversals()).toBe(0);
});

test('a failed settings save shows an error and stays on the page', async () => {
  const mem = memoryCollections();
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return name === 'preferences' ? { ...c, put: async () => { throw new Error('boom'); } } : c;
    },
  };
  const { deps } = await setup({ store, range: 'unset' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: 'sunday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText("Couldn't save settings: boom")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
});

test('saving view settings writes nothing to the project settings collection', async () => {
  const mem = memoryCollections();
  const puts: string[] = [];
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return { ...c, put: async (id: string, doc: T) => { if (name === 'settings') puts.push(id); return c.put(id, doc); } };
    },
  };
  const { deps } = await setup({ store });
  puts.length = 0;
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(/Updated 1 h ago/);
  expect(puts).toEqual([]);
});

test('retry after a failed initial load re-runs the load', async () => {
  const mem = memoryCollections();
  let armed = false;
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return { ...c, get: async (id: string) => { if (armed) { armed = false; throw new Error('boom'); } return c.get(id); } };
    },
  };
  const { deps } = await setup({ store, cache: 'none' });
  armed = true;
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText('boom')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});







test('a failed Data Mart cache save keeps the new values on screen and shows a note', async () => {
  const mem = memoryCollections();
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return name === 'mart-cache' ? { ...c, put: async () => { throw new Error('too big'); } } : c;
    },
  };
  const { deps, d } = await setup({ store, cache: 'none' });
  d.rows = () => [{ 'revenue | SUM': 1234 }];
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText("Couldn't save the refreshed data for 1 Data Mart(s).")).toBeInTheDocument();
  expect(screen.getByText('1.23K')).toBeInTheDocument();
});

test('a custom range computes the canvas without touching the Data Mart cache', async () => {
  const inner = memoryCollections();
  const seen: string[] = [];
  const store: CollectionsLike = {
    collections<T>(name: string) {
      const c = inner.collections<T>(name);
      if (name !== 'mart-cache') return c;
      return { get: async (id: string) => { seen.push(`get:${id}`); return c.get(id); }, put: async (id: string, doc: T) => { seen.push(`put:${id}`); return c.put(id, doc); } };
    },
  };
  const { deps, traversals } = await setup({ store, cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
  seen.length = 0;
  const before = traversals();
  const cal = within(screen.getByRole('group', { name: 'Range calendar' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, October 5, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, October 12, 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(before));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
  expect(seen).toEqual([]);
});

test('the toolbar shows the cut windows when a comparison is cut short', async () => {
  const { deps } = await setup({ cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  const cmp = within(screen.getByRole('group', { name: 'Comparison calendar' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Next month' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Next month' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Monday, September 7, 2026' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Wednesday, September 9, 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(document.querySelector('.gy-header-sub')!.textContent).toMatch(/^Oct 1–3 vs Sep 7–9, 2026 · /));
  expect(document.querySelector('.gy-period-shown')).toBeNull();
});

test('the week start setting changes the cache key of a week preset', async () => {
  const keyOf = async (weekStart: 'monday' | 'sunday') => {
    const { deps, store } = await setup({ cache: 'none', range: 'unset' });
    await saveViewSettings(store, { defaultPreset: 'wtd', comparisonDefault: false, weekStart });
    render(<App ctx={ctxWith().ctx} deps={deps} />);
    await screen.findByText(/Updated just now/);
    const key = cacheKey({ kind: 'preset', preset: 'wtd' }, { kind: 'off' }, weekStart);
    await waitFor(async () => expect(await store.collections('mart-cache').get(`${GID}:${key}`)).not.toBeNull());
    cleanup();
    return key;
  };
  expect(await keyOf('monday')).not.toBe(await keyOf('sunday'));
});

test('with a comparison the header shows the days so far, not the whole range', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(document.querySelector('.gy-header-sub')!.textContent).toMatch(/^Oct 1–\d+ vs Jul 1–\d+, 2026 · /));
});

test('a projected range shows the whole period against the whole previous one', async () => {
  const { deps, store } = await setup({ cache: 'none', range: 'unset' });
  await saveViewSettings(store, { defaultPreset: 'cur_month', comparisonDefault: true, weekStart: 'monday' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(document.querySelector('.gy-header-sub')!.textContent).toMatch(/^Oct 1–31 vs Sep 1–30, 2026 · /));
});

test('opens on the default range, never the last applied one; the comparison choice is remembered', async () => {
  const { deps, store } = await setup({ cache: 'none', range: 'unset' });
  await saveViewSettings(store, { defaultPreset: 'cur_month', comparisonDefault: true, weekStart: 'monday' });
  // a 0.4 doc that still carries the last applied range
  await savePreferences(store, { range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'off' } });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent(/^This month$/);
});

test('with no default range every open is the ontology view, even after a range was applied', async () => {
  const { deps, store } = await setup({ cache: 'none', range: 'unset' });
  await savePreferences(store, { range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'preset', preset: 'previous_period' } });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
});

test('applying a range saves it as the member preference', async () => {
  const { deps, store } = await setup({ cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  // the range itself is not remembered; the comparison is
  await waitFor(async () => expect(await loadPreferences(store)).toEqual({ range: null, compare: { kind: 'preset', preset: 'previous_period' } }));
});

test('a failed preferences save leaves the canvas working', async () => {
  const mem = memoryCollections();
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return name === 'preferences' ? { ...c, put: async () => { throw new Error('boom'); } } : c;
    },
  };
  const { deps } = await setup({ store, cache: 'none', range: 'unset' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Last month'));
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
});

test('changing the default range in settings resets the choice and saves it', async () => {
  const { deps, store } = await setup({ cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText(/Default date range/i), { target: { value: 'last_month' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Last month'));
  expect((await loadViewSettings(store)).defaultPreset).toBe('last_month');
});

// holds the mart list and every traversal until released, so a test can look at the steps in between
function gated(deps: AppDeps) {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let openList!: () => void;
  const listGate = new Promise<void>((r) => { openList = r; });
  const o = deps.owox;
  const owox = {
    ...o,
    dataMarts: {
      list: async () => { await listGate; return o.dataMarts.list(); },
      traverseData: async (...a: Parameters<typeof o.dataMarts.traverseData>) => { await gate; return o.dataMarts.traverseData(...a); },
    },
  } as AppDeps['owox'];
  return { deps: { ...deps, owox }, openList, open };
}

const line = () => screen.queryByRole('progressbar', { name: 'Loading data' });

test('the initial page is the line with the label under it', async () => {
  const s = await setup({ cache: 'none' });
  const g = gated(s.deps);
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  expect(line()).not.toBeNull();
  expect(screen.getByText('Loading settings and model…')).toBeInTheDocument();
  g.openList();
  g.open();
});

test('without a cache the line and step text walk through the steps and go away', async () => {
  const s = await setup({ cache: 'none' });
  const g = gated(s.deps);
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  expect(await screen.findByText(/Loading settings and model…/)).toBeInTheDocument();
  await waitFor(() => expect(line()).toHaveAttribute('data-determinate', 'false'));
  g.openList();
  expect(await screen.findByText(/Loading metrics 0 of \d+/)).toBeInTheDocument();
  g.open();
  await waitFor(() => expect(line()).toBeNull());
  expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
});

test('a fresh cache shows no line', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByText(/Updated 1 h ago/);
  expect(line()).toBeNull();
});

test('a stale cache refreshes behind the line, cards stay interactive', async () => {
  const s = await setup({ cache: 'stale' });
  const g = gated(s.deps);
  const { container } = render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  g.openList();
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(line()).not.toBeNull());
  expect(container.querySelector('.gy-bands')).not.toHaveAttribute('inert');
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

test('the refresh icon shows the line', async () => {
  const s = await setup();
  const g = gated(s.deps);
  g.openList();
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  await screen.findByText(/Updated 1 h ago/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText(/Loading metrics 0 of \d+/)).toBeInTheDocument();
  await waitFor(() => expect(line()).toHaveAttribute('aria-valuenow', '0'));
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

test('Refresh never says Reading Data Marts', async () => {
  const s = await setup();
  const g = gated(s.deps);
  g.openList();
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  await screen.findByText(/Updated 1 h ago/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText(/Loading metrics/)).toBeInTheDocument();
  expect(screen.queryByText(/Reading Data Marts/)).toBeNull();
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

// traversals of a held mart wait until the returned opener is called; each call keeps the gate and value it started with
function perMart(deps: AppDeps, initial: Record<string, number>) {
  const gates = new Map<string, Promise<void>>();
  const values = { ...initial };
  const started = { count: 0 };
  const o = deps.owox;
  const owox = {
    ...o,
    dataMarts: {
      list: o.dataMarts.list,
      traverseData: async (...a: Parameters<typeof o.dataMarts.traverseData>) => {
        started.count++;
        const gate = gates.get(a[0]);
        const v = values[a[0]] ?? 1;
        await gate;
        return { async *rowChunks() { yield [{ 'revenue | SUM': v, 'id | COUNTUNIQUE': v, date: '2026-10-20' }]; } };
      },
    },
  } as AppDeps['owox'];
  const hold = (id: string) => {
    let open!: () => void;
    gates.set(id, new Promise<void>((r) => { open = r; }));
    return () => { gates.delete(id); open(); };
  };
  return { deps: { ...deps, owox }, hold, values, started };
}

test('a card shows its number before the refresh finishes', async () => {
  const s = await setup({ cache: 'none', withCustomers: true });
  const p = perMart(s.deps, { [GID]: 4242, [CID]: 7 });
  const openC = p.hold(CID);
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  await waitFor(() => expect(container.querySelector(`[data-class-id="${GID}"]`)).toHaveTextContent('4.24K'));
  expect(line()).not.toBeNull();
  expect(container.querySelector(`[data-class-id="${CID}"]`)).toHaveAttribute('data-status', 'loading');
  openC();
  await waitFor(() => expect(line()).toBeNull());
});

test('old numbers stay until a new one replaces them', async () => {
  const s = await setup({ cache: 'none', withCustomers: true });
  const p = perMart(s.deps, { [GID]: 4242, [CID]: 7 });
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  await screen.findByText(/Updated just now/);
  const card = () => container.querySelector(`[data-class-id="${GID}"]`)!;
  expect(card()).toHaveTextContent('4.24K');
  p.values[GID] = 9999;
  const openG = p.hold(GID);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(line()).not.toBeNull());
  await new Promise((r) => setTimeout(r, 30));
  expect(card()).toHaveTextContent('4.24K');
  openG();
  await waitFor(() => expect(line()).toBeNull());
  expect(card()).toHaveTextContent('10K');
});

test('a superseded refresh does not apply its partials or its final doc', async () => {
  const s = await setup({ cache: 'none' });
  const p = perMart(s.deps, { [GID]: 1111 });
  const openOld = p.hold(GID);
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  await waitFor(() => expect(p.started.count).toBeGreaterThan(0));
  const first = p.started.count;
  // a second refresh starts with its own value and stays held
  p.values[GID] = 2222;
  const openNew = p.hold(GID);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(p.started.count).toBeGreaterThan(first));
  openOld();
  await new Promise((r) => setTimeout(r, 30));
  const card = () => container.querySelector(`[data-class-id="${GID}"]`)!;
  expect(card()).not.toHaveTextContent('1.11K');
  expect(card()).toHaveAttribute('data-status', 'loading');
  expect(line()).not.toBeNull();
  openNew();
  await waitFor(() => expect(line()).toBeNull());
  expect(card()).toHaveTextContent('2.22K');
});

test('a custom range already on screen is not blanked by Settings and Back', async () => {
  const s = await setup({ cache: 'none' });
  const p = perMart(s.deps, { [GID]: 4242 });
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  const cal = within(screen.getByRole('group', { name: 'Range calendar' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, October 12, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Tuesday, October 20, 2026' }));
  const before = p.started.count;
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(p.started.count).toBeGreaterThan(before));
  await waitFor(() => expect(line()).toBeNull());
  const card = () => container.querySelector(`[data-class-id="${GID}"]`)!;
  expect(card()).toHaveTextContent('4.24K');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  // coming back re-runs the refresh for the range on screen; hold it to look at the canvas meanwhile
  await screen.findByLabelText('Week starts on');
  p.values[GID] = 9999;
  const openG = p.hold(GID);
  const again = p.started.count;
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(p.started.count).toBeGreaterThan(again));
  expect(card()).toHaveTextContent('4.24K');
  openG();
  await waitFor(() => expect(line()).toBeNull());
  expect(card()).toHaveTextContent('10K');
});




describe('data quality icons', () => {
  const summary = { state: 'PASSED', enabledChecks: 4, passedChecks: 4, failedChecks: 0, errorChecks: 0, warningFindings: 0, errorFindings: 0, highestSeverity: null, lastRunAt: null };

  test('one POST for the canvas shows the icon, and a click opens the quality page', async () => {
    const { deps, d } = await setup();
    d.quality = (ids) => ({ items: ids.map((dataMartId) => ({ dataMartId, summary })) });
    const live = fakeOwox(d);
    const navigate = vi.fn();
    render(<App ctx={{ projectId: 'p', ui: { setRoute: vi.fn(), navigate } } as never} deps={{ ...deps, owox: live }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Data quality: all 4 checks passed' }));
    expect(navigate).toHaveBeenCalledWith(`/ui/p/data-marts/${GID}/quality`);
    expect(live.calls.filter((c) => c.path.endsWith('/data-quality/summaries'))).toHaveLength(1);
  });

  test('a refused call shows no icon and no error', async () => {
    const { deps, d } = await setup();
    d.quality = () => { throw Object.assign(new Error('403'), { status: 403 }); };
    const live = fakeOwox(d);
    render(<App ctx={{ projectId: 'p', ui: { setRoute: vi.fn(), navigate: vi.fn() } } as never} deps={{ ...deps, owox: live }} />);
    await screen.findByText(/Updated 1 h ago/);
    await waitFor(() => expect(live.calls.some((c) => c.path.endsWith('/summaries'))).toBe(true));
    expect(screen.queryByRole('button', { name: /Data quality/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

test('the first open shows the ontology view and queries nothing', async () => {
  const { deps, traversals, owox, d } = await setup({ range: 'unset', cache: 'none' });
  d.quality = () => ({ summaries: [] });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
  await new Promise((r) => setTimeout(r, 50));
  expect(traversals()).toBe(0);
  expect(owox.calls.some((c) => c.path.includes('data-quality'))).toBe(false);
  expect(document.querySelector('.gy-header-sub')).toBeNull();
  expect(screen.queryByText(/Loading metrics/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
});

test('choosing a range runs the queries; Clear goes back and keeps the comparison', async () => {
  const { deps, traversals, store } = await setup({ range: 'unset', cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  expect(screen.getByLabelText('Compare')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  expect(screen.getByLabelText('Compare')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('This month vs previous');
  fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
  await waitFor(async () => expect(await loadPreferences(store)).toEqual({ range: null, compare: { kind: 'preset', preset: 'previous_period' } }));
  expect(document.querySelector('.gy-header-sub')).toBeNull();
  // choosing again restores the comparison
  fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Last month vs previous');
});

test('a member who cleared the range reopens on the ontology view', async () => {
  const { deps } = await setup({ range: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
});


test('from no range, a preset applied without touching Compare brings the comparison default', async () => {
  const { deps, store } = await setup({ range: 'unset', cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('This month vs previous');
  await waitFor(async () => expect((await loadPreferences(store))?.compare).toEqual({ kind: 'preset', preset: 'previous_period' }));
});

test('from no range, unchecking Compare in the panel keeps it off', async () => {
  const { deps, store } = await setup({ range: 'unset', cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  fireEvent.click(screen.getByLabelText('Compare'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent(/^This month$/);
  await waitFor(async () => expect(await loadPreferences(store)).toEqual({ range: null, compare: { kind: 'off' } }));

test('a second open on the same day answers every query from the Data Mart cache', async () => {
  const { deps, traversals, store } = await setup({ cache: 'none' });
  const first = render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByText(/Updated just now/);
  await waitFor(() => expect(first.container.querySelector('[role="progressbar"]')).toBeNull());
  const key = cacheKey({ kind: 'preset', preset: 'qtd' }, { kind: 'preset', preset: 'previous_period' });
  await waitFor(async () => expect(await store.collections('mart-cache').get(`${GID}:${key}`)).not.toBeNull());
  cleanup();
  const after = traversals();
  expect(after).toBeGreaterThan(0);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
  expect(traversals()).toBe(after);
});

test('Refresh skips the Data Mart cache and queries live', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByText(/Updated 1 h ago/);
  expect(traversals()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
});
