import { fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_SETTINGS } from '../types';
import type { SetupTabProps } from './SetupTab';

const setupProps: SetupTabProps = { rows: [], loading: false, readOnly: false, message: null, picked: {}, onPick: () => {}, dirty: 0, saving: false, onSave: () => {}, onDiscard: () => {}, savedOpen: new Set(), onRetry: () => {}, onOpen: () => {} };

test('saves the chosen week start', () => {
  const onSave = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onBack={() => {}} />);
  const select = screen.getByLabelText('Week starts on') as HTMLSelectElement;
  expect(select.value).toBe('monday');
  fireEvent.change(select, { target: { value: 'sunday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, weekStart: 'sunday' });
});

test('the tabs are General, Setup and Schedules, a tablist that arrow keys move through', () => {
  const onTabChange = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} onTabChange={onTabChange} />);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Setup', 'Schedules']);
  const general = screen.getByRole('tab', { name: 'General' });
  const setup = screen.getByRole('tab', { name: 'Setup' });
  expect(general).toHaveAttribute('aria-selected', 'true');
  expect(setup).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(general, { key: 'ArrowRight' });
  expect(setup).toHaveAttribute('aria-selected', 'true');
  expect(setup).toHaveFocus();
  expect(onTabChange).toHaveBeenLastCalledWith('setup');
  expect(screen.getByLabelText('Week starts on')).not.toBeVisible();
  fireEvent.keyDown(setup, { key: 'ArrowRight' });
  const schedules = screen.getByRole('tab', { name: 'Schedules' });
  expect(schedules).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(schedules, { key: 'ArrowRight' });
  expect(general).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(general, { key: 'End' });
  expect(schedules).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(schedules, { key: 'Home' });
  expect(general).toHaveFocus();
});

test('General keeps only the member view settings; the threshold moved to Setup', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} />);
  expect(screen.getByRole('group', { name: 'Your view' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Project' })).toBeNull();
  expect(screen.queryByLabelText(/Red when below plan/)).toBeNull();
});

test('the Setup panel shows the Setup tab and stays mounted behind General', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} setup={setupProps} tab="setup" />);
  expect(document.getElementById('gy-panel-setup')).not.toHaveAttribute('hidden');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(document.getElementById('gy-panel-setup')).toHaveAttribute('hidden');
  expect(document.getElementById('gy-panel-setup')!.childElementCount).toBeGreaterThan(0);
});

test('every tab points at an existing panel', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} />);
  for (const t of screen.getAllByRole('tab')) expect(document.getElementById(t.getAttribute('aria-controls')!)).not.toBeNull();
});

test('the default date range says it applies only to the member', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} />);
  expect(screen.getByLabelText('Default date range').closest('.gy-field')?.textContent).toContain('Only for you');
});

test('Settings offers None (ontology view) and it is selected when there is no default preset', () => {
  const onSave = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onBack={() => {}} />);
  const select = screen.getByLabelText('Default date range') as HTMLSelectElement;
  expect(select.options[0]!.textContent).toBe('None (ontology view)');
  expect(select.value).toBe('');
  fireEvent.change(select, { target: { value: 'mtd' } });
  fireEvent.change(select, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, defaultPreset: null });
});

describe('the page header carries Save on Setup', () => {
  const page = (over: Partial<SetupTabProps> = {}, tab: 'setup' | 'general' = 'setup') =>
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} setup={{ ...setupProps, dirty: 2, ...over }} tab={tab} />);
  const header = () => document.querySelector('.gy-settings-header') as HTMLElement;

  test('Save, Discard and the change count sit in the header', () => {
    const onSave = vi.fn(); const onDiscard = vi.fn();
    page({ onSave, onDiscard });
    expect(within(header()).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(header()).getByText('2 changes')).toBeInTheDocument();
    fireEvent.click(within(header()).getByRole('button', { name: 'Discard' }));
    fireEvent.click(within(header()).getByRole('button', { name: 'Save' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('General has no Setup save in the header, and read-only has none either', () => {
    const { unmount } = page({}, 'general');
    expect(within(header()).queryByRole('button', { name: 'Save' })).toBeNull();
    unmount();
    page({ readOnly: true });
    expect(within(header()).queryByRole('button', { name: 'Save' })).toBeNull();
  });

  test('the header, tabs and progress bar share one sticky wrapper', () => {
    page();
    const sticky = document.querySelector('.gy-settings-sticky') as HTMLElement;
    expect(sticky).toContainElement(header());
    expect(sticky).toContainElement(screen.getByRole('tablist'));
    expect(sticky).toContainElement(screen.getByRole('progressbar'));
  });

  test('the legend sits outside the sticky wrapper', () => {
    page({ rows: [{ id: 'a', block: 'goal', title: 'T', question: 'Q', why: 'W', severity: 'error', state: 'open', current: null, aiPending: false, dismissable: false, options: [] }] });
    const sticky = document.querySelector('.gy-settings-sticky') as HTMLElement;
    const legend = document.querySelector('.gy-progress-legend') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(sticky).not.toContainElement(legend);
  });

  test('the progress bar leaves with the Setup tab', () => {
    page();
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

test('the Schedules tab follows Setup and renders the schedules tab', () => {
  const schedules = { schedules: undefined, memberId: 'u1', model: null, settings: DEFAULT_SETTINGS, store: { collections: () => { throw new Error('unused'); } } as never };
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} schedules={schedules} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schedules' }));
  expect(screen.getByText(/need a newer version/)).toBeInTheDocument();
});
