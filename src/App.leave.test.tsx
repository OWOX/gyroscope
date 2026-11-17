import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { fakeOwox } from './owox/fake';
import { memoryCollections } from './store/collections';

const GID = '11111111-1111-1111-1111-111111111111';
// puts wait on `gate` (a save in flight) or reject while `fail` is set
const hooks: { gate: Promise<void> | null; fail: boolean } = { gate: null, fail: false };
const slow = (inner: ReturnType<typeof memoryCollections>): AppDeps['store'] => ({
  collections: (<T,>(name: string) => {
    const c = inner.collections<T>(name);
    return { ...c, put: async (id: string, doc: T) => { await hooks.gate; if (hooks.fail) throw new Error('boom'); return c.put(id, doc); } };
  }) as AppDeps['store']['collections'],
});
const deps = (): AppDeps => ({
  owox: fakeOwox({
    projectDescription: 'We sell shoes', contexts: [],
    marts: [{ id: GID, title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' }],
    details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } },
    blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
  }),
  store: slow(memoryCollections()), userId: 'u1', now: () => new Date('2026-11-14T10:00:00Z'),
});
const mount = (ui: Record<string, unknown> = {}) => {
  const navigate = vi.fn();
  const ctx = { projectId: 'p1', ui: { setRoute: vi.fn(), navigate, ...ui } } as never;
  render(<App ctx={ctx} deps={deps()} />);
  return navigate;
};
const openSetup = async () => fireEvent.click(await screen.findByRole('button', { name: 'Open Setup' }));
const stage = async () => { await openSetup(); fireEvent.click((await screen.findAllByRole('radio', { name: /Recommended/ }))[0]!); await screen.findByText(/1 unsaved|unsaved/i).catch(() => undefined); };
const dialog = () => screen.queryByRole('alertdialog');

afterEach(() => { cleanup(); hooks.gate = null; hooks.fail = false; });

test('Back with nothing staged leaves at once', async () => {
  mount();
  await openSetup();
  await screen.findAllByText('Business Critical Number');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(dialog()).toBeNull();
});

test('Back with staged picks asks; Stay keeps them, Escape is Stay', async () => {
  mount();
  await stage();
  const back = screen.getByRole('button', { name: 'Back' });
  back.focus();
  fireEvent.click(back);
  expect(dialog()).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByText('Leave without saving?')).toBeInTheDocument();
  expect(screen.getByText('You have 1 unsaved change in Setup.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Stay' }), { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Leave without saving' })).toHaveFocus();
  fireEvent.keyDown(dialog()!, { key: 'Escape' });
  expect(dialog()).toBeNull();
  expect(back).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThan(0);
  fireEvent.click(back);
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(dialog()).toBeNull();
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
});

test('Leave without saving leaves settings and drops the picks', async () => {
  mount();
  await stage();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
  expect(dialog()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  await openSetup();
  await screen.findAllByText('Business Critical Number');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(dialog()).toBeNull();
});

test('the General tab Save asks with staged picks, and not without', async () => {
  mount();
  await stage();
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(dialog()).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Setup' }));
  expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(dialog()).not.toBeNull();
  fireEvent.keyDown(dialog()!, { key: 'Escape' });
  expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
});

test('an OWOX link asks with staged picks: Stay does not navigate, Leave does', async () => {
  const navigate = mount();
  await stage();
  const link = (await screen.findAllByRole('button', { name: /in OWOX/ }))[0]!;
  fireEvent.click(link);
  expect(dialog()).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(link);
  fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
  expect(navigate).toHaveBeenCalledTimes(1);
});

test('setUnsaved follows the dirty count between 0 and above, and false on unmount', async () => {
  const setUnsaved = vi.fn();
  mount({ setUnsaved });
  await openSetup();
  await screen.findAllByText('Business Critical Number');
  expect(setUnsaved).not.toHaveBeenCalled();
  const radio = (await screen.findAllByRole('radio', { name: /Recommended/ }))[0]!;
  fireEvent.click(radio);
  await waitFor(() => expect(setUnsaved).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(setUnsaved).toHaveBeenLastCalledWith(false));
  fireEvent.click((await screen.findAllByRole('radio', { name: /Recommended/ }))[0]!);
  await waitFor(() => expect(setUnsaved).toHaveBeenLastCalledWith(true));
  cleanup();
  expect(setUnsaved).toHaveBeenLastCalledWith(false);
});

test('without setUnsaved on the host nothing breaks', async () => {
  mount();
  await stage();
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
});

test('Back while a Setup save runs does not ask, and leaves nothing: the picks and the page stay', async () => {
  let open!: () => void;
  hooks.gate = new Promise<void>((r) => { open = r; });
  hooks.fail = true;
  mount();
  await stage();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Saving…' });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(dialog()).toBeNull();
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('title', 'Saving Setup…');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  for (const n of ['Save', 'Cancel']) expect(screen.getByRole('button', { name: n })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('title', 'Saving Setup…');
  fireEvent.click(screen.getByRole('tab', { name: 'Setup' }));
  open();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
  expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThan(0);
});

test('the dialog closes and the exit goes on when the picks are gone meanwhile', async () => {
  mount();
  await stage();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(dialog()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(dialog()).toBeNull());
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
});

test('General Save with picks: the choices are honest, a failed save keeps the picks', async () => {
  mount();
  await stage();
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  hooks.fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Discard Setup changes?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Discard Setup changes' }));
  expect(await screen.findByText(/Couldn't save settings/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Setup' }));
  expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  hooks.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard Setup changes' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back' })).toBeNull());
  await openSetup();
  await screen.findAllByText('Business Critical Number');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(dialog()).toBeNull();
});

test('focus stays in the dialog after a click on its text, and the page behind is inert until it closes', async () => {
  mount();
  await stage();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  const page = () => [...dialog()!.parentElement!.parentElement!.children].filter((el) => !el.contains(dialog()));
  const els = page();
  expect(els.length).toBeGreaterThan(0);
  expect(page().every((el) => el.hasAttribute('inert'))).toBe(true);
  (document.activeElement as HTMLElement).blur();
  expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(dialog()!, { key: 'Tab' });
  expect(dialog()!.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(els.some((el) => el.hasAttribute('inert'))).toBe(false);
});
