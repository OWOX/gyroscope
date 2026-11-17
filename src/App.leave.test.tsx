import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { fakeOwox } from './owox/fake';
import { memoryCollections } from './store/collections';

const GID = '11111111-1111-1111-1111-111111111111';
const deps = (): AppDeps => ({
  owox: fakeOwox({
    projectDescription: 'We sell shoes', contexts: [],
    marts: [{ id: GID, title: 'Orders', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' }],
    details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } },
    blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
  }),
  store: memoryCollections(), userId: 'u1', now: () => new Date('2026-11-14T10:00:00Z'),
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

afterEach(cleanup);

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
