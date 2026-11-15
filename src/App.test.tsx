import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, depsFrom, type AppDeps } from './App';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { memoryCollections, type CollectionsLike } from './store/collections';
import { EMPTY_SETUP, saveSetup } from './store/settings';
import type { ProjectSettingsV5 } from './types';

const GID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-11-14T10:00:00Z');
const data = (roles?: string[]): FakeOwoxData => ({
  projectDescription: 'We sell shoes', contexts: [],
  marts: [{ id: GID, title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' }],
  details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } },
  blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
  ...(roles ? { roles } : {}),
});
const filled: ProjectSettingsV5 = { ...EMPTY_SETUP, goal: { martId: GID, measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', kind: 'flow', alias: 'Revenue', plan: null } };
const deps = (store: CollectionsLike = memoryCollections(), roles?: string[]): AppDeps => ({ owox: fakeOwox(data(roles)), store, userId: 'u1', now: () => NOW });
const ctxWith = (route?: string) => ({ projectId: 'p1', route, ui: { setRoute: vi.fn() } }) as never;

afterEach(cleanup);

test('a new project opens on the blocked screen; Open Setup shows the Setup tab', async () => {
  render(<App ctx={ctxWith()} deps={deps()} />);
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }));
  expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
  expect((await screen.findAllByText('Business Critical Number')).length).toBeGreaterThan(0);
});

test('accepting the recommended critical number in Setup and going back shows the canvas', async () => {
  render(<App ctx={ctxWith()} deps={deps()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Setup' }));
  fireEvent.click((await screen.findAllByRole('button', { name: /^Accept / }))[0]!);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText(/blocker/)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});

test('a member opening a new project is told to ask an admin, and Setup opens read-only', async () => {
  render(<App ctx={ctxWith()} deps={deps(memoryCollections(), ['viewer'])} />);
  expect(await screen.findByText('Ask a project admin to finish Setup.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }));
  expect((await screen.findAllByText('Business Critical Number')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /^Accept / })).toBeNull();
});

test('a project with saved settings opens on the canvas with the goal card', async () => {
  const store = memoryCollections();
  await saveSetup(store, EMPTY_SETUP, filled, 'Ann', NOW);
  render(<App ctx={ctxWith()} deps={deps(store)} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector(`[data-class-id="${GID}"]`)).toHaveTextContent('Orders'));
});

test.each(['/settings/setup', '/settings/checkup', '/settings/ontology'])('%s opens the Setup tab', async (route) => {
  const store = memoryCollections();
  await saveSetup(store, EMPTY_SETUP, filled, 'Ann', NOW);
  render(<App ctx={ctxWith(route)} deps={deps(store)} />);
  const tab = await screen.findByRole('tab', { name: 'Setup' });
  expect(tab).toHaveAttribute('aria-selected', 'true');
});

test('/settings opens General, and a blocked project still opens the Setup route', async () => {
  const store = memoryCollections();
  await saveSetup(store, EMPTY_SETUP, filled, 'Ann', NOW);
  const { unmount } = render(<App ctx={ctxWith('/settings')} deps={deps(store)} />);
  expect(await screen.findByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  unmount();
  render(<App ctx={ctxWith('/settings/setup')} deps={deps()} />);
  expect(await screen.findByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
});

test('a failed load shows an error with Retry', async () => {
  const mem = memoryCollections();
  let fail = true;
  const store: CollectionsLike = { collections: <T,>(name: string) => { const c = mem.collections<T>(name); return { ...c, get: async (id: string) => { if (fail) throw new Error('boom'); return c.get(id); } }; } };
  render(<App ctx={ctxWith()} deps={deps(store)} />);
  expect(await screen.findByText('boom')).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});

test('a failed Data Mart read shows an error with Retry, not the blocked screen', async () => {
  const d = deps();
  let fail = true;
  d.owox = { ...d.owox, project: { getSettings: async () => { if (fail) throw new Error('READ_FAILED: boom'); return { description: null }; } } };
  render(<App ctx={ctxWith()} deps={d} />);
  expect(await screen.findByText(/READ_FAILED/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Goal can't be tracked" })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});

test('the AI uses the fast tier, or Reasoning when only that is mapped', () => {
  const gen = (ai: object) => depsFrom({ credentials: { ai }, owox: {}, userId: 'u1' } as never).generateWith;
  expect(gen({ fast: {}, reasoning: {} })).not.toBeNull();
  expect(gen({ reasoning: {} })).not.toBeNull();
  expect(gen({})).toBeNull();
  expect(depsFrom({ owox: {}, userId: 'u1' } as never).generateWith).toBeNull();
});
