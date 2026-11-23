import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { render, screen, fireEvent, waitFor, within } from '../test-host';
import { SchedulesTab } from './SchedulesTab';
import { DEFAULT_SETTINGS } from '../types';
import { model as fixtureModel } from '../test/fixtures';

function fakeSchedules(initial: PluginSchedule[] = []) {
  let rows = [...initial];
  let n = 0;
  const api: PluginSchedules = {
    list: vi.fn(async () => rows),
    get: vi.fn(async (id: string) => rows.find((r) => r.id === id)!),
    create: vi.fn(async (s) => { const row: PluginSchedule = { id: `s${++n}`, name: s.name ?? null, action: s.action, parameters: s.parameters, cron: s.cron, timeZone: s.timeZone, enabled: s.enabled ?? true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '' }; rows.push(row); return row; }),
    update: vi.fn(async (id, patch) => { rows = rows.map((r) => (r.id === id ? { ...r, ...patch, name: patch.name === undefined ? r.name : patch.name } : r)); return rows.find((r) => r.id === id)!; }),
    pause: vi.fn(async (id) => { rows = rows.map((r) => (r.id === id ? { ...r, enabled: false } : r)); return rows.find((r) => r.id === id)!; }),
    resume: vi.fn(async (id) => { rows = rows.map((r) => (r.id === id ? { ...r, enabled: true } : r)); return rows.find((r) => r.id === id)!; }),
    delete: vi.fn(async (id) => { rows = rows.filter((r) => r.id !== id); }),
  };
  return api;
}
const range = { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' }, weekStart: 'monday' };
const row = (id: string, extra: Partial<PluginSchedule> = {}): PluginSchedule => ({
  id, name: null, action: 'warm-cache', parameters: { ranges: [range] }, cron: '0 9 * * 1,2,3,4,5', timeZone: 'UTC',
  enabled: true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '', ...extra,
});
const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!;
const openMenu = async (name = /^Actions for/) => { fireEvent.click(await screen.findByRole('button', { name })); };
const pickRanges = (labels: string[]) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Data ranges' }));
  for (const l of labels) fireEvent.click(screen.getByRole('option', { name: l }));
};

const props = (schedules: PluginSchedules | undefined, extra = {}) => ({ schedules, model: fixtureModel, settings: { ...DEFAULT_SETTINGS, defaultPreset: 'qtd' as const }, ...extra });

test('a member without a default must select at least one date range', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api, { settings: DEFAULT_SETTINGS })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Select at least one data range.')).toBeInTheDocument();
  expect(api.create).not.toHaveBeenCalled();
  pickRanges(['Yesterday']);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce());
});

test('without ctx.schedules the tab says OWOX is too old', () => {
  render(<SchedulesTab {...props(undefined)} />);
  expect(screen.getByText(/need a newer version/)).toBeInTheDocument();
});

test('lists every warm-cache schedule, one with unreadable parameters too, and counts all of them', async () => {
  render(<SchedulesTab {...props(fakeSchedules([row('a'), row('b', { action: 'other' }), row('c', { parameters: { junk: true }, cron: '0 6 * * *' })]))} />);
  expect(await screen.findByText('3 of 20 schedules')).toBeInTheDocument();
  expect(screen.getByText('Weekly on Monday, Tuesday, Wednesday, Thursday, Friday at 09:00')).toBeInTheDocument();
  expect(screen.getByText('Daily at 06:00')).toBeInTheDocument();
  // only the schedule with readable parameters lists its range
  expect(screen.getAllByText('This quarter to date')).toHaveLength(1);
  expect(screen.getAllByRole('row')).toHaveLength(1 + 3 - 1);
});

test('a schedule with unreadable parameters is saved with fresh ones', async () => {
  const api = fakeSchedules([row('c', { parameters: { junk: true } })]);
  render(<SchedulesTab {...props(api)} />);
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('c', expect.objectContaining({ parameters: { ranges: [expect.objectContaining({ weekStart: 'monday' })] } })));
});

test('at the limit Add is off and says why', async () => {
  render(<SchedulesTab {...props(fakeSchedules(Array.from({ length: 20 }, (_, i) => row(`s${i}`))))} />);
  expect(await screen.findByRole('button', { name: 'Add schedule' })).toBeDisabled();
  expect(screen.getByText(/You have 20 schedules, the most OWOX allows\./)).toBeInTheDocument();
});

test('adding a schedule calls the SDK even when native submission is blocked', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every 6 hours' }));
  pickRanges(['This year to date']);
  const save = screen.getByRole('button', { name: 'Save' });
  // The plugin iframe allows click handlers but blocks the browser's form submission.
  save.addEventListener('click', (event) => event.preventDefault(), { once: true });
  fireEvent.click(save);
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce());
  const arg = (api.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(arg).toMatchObject({ action: 'warm-cache', cron: '0 */6 * * *' });
  expect(arg.parameters).not.toHaveProperty('memberId');
  expect(arg.parameters.ranges.map((r: { range: { preset: string } }) => r.range.preset)).toEqual(['ytd']);
});

test('without a model the form refuses to save', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api, { model: null })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Finish Setup in Gyroscope');
  expect(api.create).not.toHaveBeenCalled();
});

test('a refusal shows its code', async () => {
  const api = fakeSchedules();
  api.create = vi.fn(async () => { throw Object.assign(new Error('Too many'), { name: 'PluginActionError', code: 'TOO_MANY_SCHEDULES' }); });
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('TOO_MANY_SCHEDULES');
});

test('the switch pauses and resumes the schedule', async () => {
  const api = fakeSchedules([row('a')]);
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Enabled' }));
  await waitFor(() => expect(api.pause).toHaveBeenCalledWith('a'));
  fireEvent.click(await screen.findByRole('switch', { name: 'Enabled' }));
  await waitFor(() => expect(api.resume).toHaveBeenCalledWith('a'));
});

test('the row menu edits, pauses, resumes and deletes', async () => {
  const api = fakeSchedules([row('a')]);
  render(<SchedulesTab {...props(api)} />);
  await openMenu();
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit schedule', 'Pause schedule', 'Delete schedule']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pause schedule' }));
  await waitFor(() => expect(api.pause).toHaveBeenCalledWith('a'));
  await openMenu();
  expect(screen.getByRole('menuitem', { name: 'Resume schedule' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every hour' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ cron: '0 */1 * * *' })));
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete schedule' }));
  const confirm = screen.getByRole('alertdialog', { name: 'Delete this schedule?' });
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Delete schedule' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('a'));
  expect(await screen.findByText('Create your first schedule')).toBeInTheDocument();
});

test('declining the delete confirmation keeps the schedule', async () => {
  const api = fakeSchedules([row('a')]);
  render(<SchedulesTab {...props(api)} />);
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete schedule' }));
  const confirm = screen.getByRole('alertdialog', { name: 'Delete this schedule?' });
  const cancel = within(confirm).getByRole('button', { name: 'Cancel' });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByRole('button', { name: /^Actions for/ })).toHaveFocus();
  expect(api.delete).not.toHaveBeenCalled();
});

test('the row menu works from the keyboard and Escape returns focus to its button', async () => {
  render(<SchedulesTab {...props(fakeSchedules([row('a')]))} />);
  const button = await screen.findByRole('button', { name: /^Actions for/ });
  button.focus();
  fireEvent.keyDown(button, { key: 'ArrowDown' });
  const items = screen.getAllByRole('menuitem');
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
  expect(items[1]).toHaveFocus();
  fireEvent.keyDown(items[1]!, { key: 'End' });
  expect(items[2]).toHaveFocus();
  fireEvent.keyDown(items[2]!, { key: 'ArrowDown' });
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(items[0]!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});

test('the last run shows a readable status, its error code and the finish time', async () => {
  const finishedAt = '2026-11-06T07:01:10Z';
  render(<SchedulesTab {...props(fakeSchedules([
    row('a', { lastRun: { executionId: 'e', status: 'FAILED', errorCode: 'NO_DATA', finishedAt } }),
    row('b', { cron: '0 6 * * *', lastRun: { executionId: 'f', status: 'TIMED_OUT', errorCode: null, finishedAt: null } }),
    row('c', { cron: '0 7 * * *', lastRun: { executionId: 'g', status: 'SUCCEEDED', errorCode: null, finishedAt } }),
  ]))} />);
  const failed = await rowOf('Weekly on Monday, Tuesday, Wednesday, Thursday, Friday at 09:00');
  expect(failed).toHaveTextContent('Failed');
  expect(failed).toHaveTextContent('NO_DATA');
  expect(failed.querySelector('time[datetime="2026-11-06T07:01:10Z"]')).not.toBeNull();
  expect(await rowOf('Daily at 06:00')).toHaveTextContent('Timed out');
  expect(await rowOf('Daily at 07:00')).toHaveTextContent('Succeeded');
});

test('every run status has its own label', async () => {
  const statuses = ['QUEUED', 'RUNNING', 'CANCELLED'] as const;
  render(<SchedulesTab {...props(fakeSchedules(statuses.map((st, i) => row(`s${i}`, { cron: `0 ${i} * * *`, lastRun: { executionId: st, status: st, errorCode: null, finishedAt: null } }))))} />);
  for (const label of ['Queued', 'Running', 'Cancelled']) expect(await screen.findByText(label)).toBeInTheDocument();
});

test('the next run is date and time to the minute, never with seconds', async () => {
  const iso = '2026-11-09T07:00:30Z';
  render(<SchedulesTab {...props(fakeSchedules([row('a', { nextRunAt: iso })]))} />);
  const shown = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const el = await screen.findByText(shown);
  expect(el.tagName).toBe('TIME');
  expect(shown).not.toMatch(/\d:\d\d:\d\d/);
});

test('with no schedules there is one action to add the first one', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  expect(await screen.findByText('Create your first schedule')).toBeInTheDocument();
  const buttons = screen.getAllByRole('button', { name: /^(Add|New) schedule$/ });
  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveAccessibleName('Add schedule');
  fireEvent.click(buttons[0]!);
  expect(screen.getByRole('dialog', { name: 'Add schedule' })).toBeInTheDocument();
});

test('uses Kyiv as the default on a browser that reports Kiev', async () => {
  const resolved = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...Intl.DateTimeFormat().resolvedOptions(), timeZone: 'Europe/Kiev',
  });
  const supported = vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Europe/Kiev', 'Europe/Kyiv']);
  try {
    const api = fakeSchedules();
    render(<SchedulesTab {...props(api)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
    const picker = screen.getByRole('combobox', { name: 'Timezone' });
    expect(picker).toHaveDisplayValue(/^Europe\/Kyiv \(\+0[23]:00\)$/);
    fireEvent.click(picker);
    expect(screen.getAllByRole('option', { name: /^Europe\/Kyiv/ })).toHaveLength(1);
    expect(screen.queryByRole('option', { name: /Kiev/ })).toBeNull();
    fireEvent.keyDown(picker, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ timeZone: 'Europe/Kyiv' })));
  } finally {
    resolved.mockRestore();
    supported.mockRestore();
  }
});

test('shows Kyiv for a saved Kiev schedule and can find it by either name', async () => {
  const api = fakeSchedules([row('a', { timeZone: 'Europe/Kiev' })]);
  render(<SchedulesTab {...props(api)} />);
  expect(await screen.findByText('Europe/Kyiv')).toBeInTheDocument();
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit schedule' }));
  const picker = screen.getByRole('combobox', { name: 'Timezone' });
  expect(picker).toHaveDisplayValue(/^Europe\/Kyiv \(/);
  fireEvent.click(picker);
  for (const query of ['Kiev', 'Kyiv']) {
    fireEvent.change(picker, { target: { value: query } });
    expect(screen.getAllByRole('option')).toEqual([screen.getByRole('option', { name: /^Europe\/Kyiv \(/ })]);
  }
  fireEvent.keyDown(picker, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Edit schedule' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ timeZone: 'Europe/Kiev' })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit schedule' }));
  const reopened = screen.getByRole('combobox', { name: 'Timezone' });
  fireEvent.click(reopened);
  fireEvent.change(reopened, { target: { value: 'Etc/UTC' } });
  expect(screen.getByRole('option', { name: 'UTC (+00:00)' })).toBeInTheDocument();
  fireEvent.keyDown(reopened, { key: 'Enter' });
  expect(reopened).toHaveValue('UTC (+00:00)');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenLastCalledWith('a', expect.objectContaining({ timeZone: 'UTC' })));
});

test('the form opens in a sheet, Escape closes it and focus returns to the Add button', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  const add = await screen.findByRole('button', { name: 'Add schedule' });
  add.focus();
  fireEvent.click(add);
  const dialog = screen.getByRole('dialog', { name: 'Add schedule' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(add).toHaveFocus();
});

test('Cancel closes the sheet and Edit returns focus to the row menu button', async () => {
  render(<SchedulesTab {...props(fakeSchedules([row('a')]))} />);
  const button = await screen.findByRole('button', { name: /^Actions for/ });
  fireEvent.click(button);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit schedule' }));
  expect(screen.getByRole('dialog', { name: 'Edit schedule' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});

test('the sheet drops its slide-in transform when the animation ends', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).not.toHaveAttribute('data-settled');
  // an animation ending on a child does not count
  fireEvent.animationEnd(screen.getByRole('button', { name: 'Close' }));
  expect(dialog).not.toHaveAttribute('data-settled');
  fireEvent.animationEnd(dialog);
  expect(dialog).toHaveAttribute('data-settled');
});

test('Escape inside an open list closes the list, not the sheet', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  const ranges = screen.getByRole('combobox', { name: 'Data ranges' });
  fireEvent.click(ranges);
  expect(screen.getByRole('listbox', { name: 'Data ranges' })).toBeInTheDocument();
  fireEvent.keyDown(ranges, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('Tab wraps inside the sheet', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true });
  expect(cancel).toHaveFocus();
});

test('days of the week are a multi-select', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Weekdays 9:00' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Days of week' }));
  fireEvent.click(screen.getByRole('option', { name: 'Saturday' }));
  fireEvent.click(screen.getByRole('option', { name: 'Monday' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ cron: '0 9 * * 2,3,4,5,6' })));
});

test('at most five ranges can be picked, listed under their groups', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Data ranges' }));
  expect(within(screen.getByRole('listbox')).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Current', 'To date', 'Past']);
  for (const l of ['This year to date', 'This quarter to date', 'This month to date', 'Last month', 'Last week']) fireEvent.click(screen.getByRole('option', { name: l }));
  expect(screen.getByRole('option', { name: 'Yesterday' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('option', { name: 'Yesterday' }));
  expect(screen.getByRole('option', { name: 'Yesterday' })).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByText('5 of 5 picked, the most allowed')).toBeInTheDocument();
  // a picked one can still be taken off, which frees the others
  fireEvent.click(screen.getByRole('option', { name: 'Last week' }));
  expect(screen.getByRole('option', { name: 'Yesterday' })).not.toHaveAttribute('aria-disabled');
  expect(screen.getByText(/None picked: your default range, /)).toBeInTheDocument();
});

test('a refused resume shows its code', async () => {
  const api = fakeSchedules([row('a', { enabled: false })]);
  api.resume = vi.fn(async () => { throw Object.assign(new Error('Paused'), { name: 'PluginActionError', code: 'PAUSED_BY_ADMIN' }); });
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Enabled' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('PAUSED_BY_ADMIN');
});

test('a schedule with an unparsable cron keeps it on save', async () => {
  const api = fakeSchedules([row('a', { cron: '0 9 1 * 1' })]);
  render(<SchedulesTab {...props(api)} />);
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit schedule' }));
  expect(screen.getByText('Cron: 0 9 1 * 1')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ cron: '0 9 1 * 1' })));
});
