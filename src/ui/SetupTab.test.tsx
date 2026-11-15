import { describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SetupTab, type SetupTabProps } from './SetupTab';
import type { Option, Row } from '../setup/types';

const set = (id: string, label: string, recommended = false): Option => ({ id, label, recommended, action: { kind: 'set', next: (s) => s } });
const row = (over: Partial<Row>): Row => ({ id: 'goal.metric', block: 'goal', title: 'Business Critical Number', question: 'What is the main business goal?', why: 'Every card is judged by how it moves this number.', severity: 'error', state: 'open', current: null, aiPicked: false, aiPending: false, dismissable: false,
  options: [set('a', 'Orders · revenue', true), set('b', 'Orders · profit')], ...over });
const props = (rows: Row[], over: Partial<SetupTabProps> = {}): SetupTabProps => ({ rows, loading: false, readOnly: false, message: null, picked: {}, onPick: vi.fn(), dirty: 0, saving: false, onSave: vi.fn(), onDiscard: vi.fn(), savedOpen: new Set(rows.filter((r) => r.state !== 'done').map((r) => r.id)), onRetry: vi.fn(), onOpen: vi.fn(), ...over });
const four = [set('a', 'Orders · revenue'), set('b', 'Orders · profit'), set('c', 'Orders · items', true), set('d', 'Orders · tax')];

test('an unset row is a radio group: Not set checked, the recommended option first and tagged, the rest behind Show more', () => {
  render(<SetupTab {...props([row({ options: four })])} />);
  const group = screen.getByRole('radiogroup', { name: 'Business Critical Number' });
  const radios = within(group).getAllByRole('radio');
  expect(radios.map((r) => (r as HTMLInputElement).labels![0]!.textContent)).toEqual(['Not set', 'Orders · itemsRecommended', 'Orders · revenue', 'Orders · profit']);
  expect(radios[0]).toBeChecked();
  expect(within(group).getByText('Recommended')).toBeInTheDocument();
  expect(within(group).queryByRole('radio', { name: /tax/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
  expect(within(group).getByRole('radio', { name: /tax/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
});

function Stateful({ rows }: { rows: Row[] }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const live = rows.map((r) => (picked[r.id] ? { ...r, state: 'done' as const } : r));
  const onPick = (id: string, o: string | null) => setPicked((p) => { const n = { ...p }; if (o === null) delete n[id]; else n[id] = o; return n; });
  return <SetupTab {...props(live, { picked, onPick, dirty: Object.keys(picked).length, savedOpen: new Set(rows.map((r) => r.id)) })} />;
}

test('picking an option checks it, raises the change count and moves the progress bar; Not set undoes it', () => {
  render(<Stateful rows={[row({}), row({ id: 'x', title: 'Other', options: [set('x1', 'Customers · count', true)] })]} />);
  const bar = () => screen.getByRole('progressbar');
  expect(bar()).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: /Orders · profit/ }));
  expect(screen.getByRole('radio', { name: /Orders · profit/ })).toBeChecked();
  expect(bar()).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByText('1 change')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Business Critical Number' })).getByRole('radio', { name: 'Not set' }));
  expect(bar()).toHaveAttribute('aria-valuenow', '0');
  expect(screen.queryByText('1 change')).toBeNull();
});

test('Save and Discard call back; both are inert while a save runs', () => {
  const p = props([row({})], { dirty: 2 });
  const { rerender } = render(<SetupTab {...p} />);
  expect(screen.getByText('2 changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(p.onSave).toHaveBeenCalledTimes(1);
  expect(p.onDiscard).toHaveBeenCalledTimes(1);
  rerender(<SetupTab {...props([row({})], { dirty: 2, saving: true })} />);
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
});

test('a set row shows its value and Change, which opens the radios with Keep <value> checked', () => {
  const done = row({ state: 'done', current: 'Orders · revenue' });
  render(<SetupTab {...props([done])} />);
  expect(screen.getByText('Orders · revenue')).toBeInTheDocument();
  expect(screen.queryByRole('radio', { hidden: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Change Business Critical Number', hidden: true }));
  expect(screen.getByRole('radio', { name: 'Keep Orders · revenue', hidden: true })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Orders · profit/, hidden: true })).not.toBeChecked();
});

test('a broken row keeps its saved value as the first radio and explains itself in the detail', () => {
  render(<SetupTab {...props([row({ state: 'broken', current: 'Orders · revenue_old', detail: "revenue_old isn't in Orders any more" })])} />);
  expect(screen.getByText("revenue_old isn't in Orders any more")).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Keep Orders · revenue_old' })).toBeChecked();
});

describe('hints', () => {
  test('open for an unset row, closed for a set row, and (?) toggles with aria-expanded', () => {
    render(<SetupTab {...props([row({}), row({ id: 'b', block: 'core', title: 'Entities', state: 'done', current: 'Orders' })])} />);
    const unset = screen.getByRole('button', { name: 'About Business Critical Number' });
    const set = screen.getByRole('button', { name: 'About Entities', hidden: true });
    expect(unset).toHaveAttribute('aria-expanded', 'true');
    expect(set).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(unset.getAttribute('aria-controls')!)).toHaveTextContent('What is the main business goal? Every card is judged by how it moves this number.');
    fireEvent.click(unset);
    expect(unset).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(set);
    expect(set).toHaveAttribute('aria-expanded', 'true');
  });
  test('a block hint is open when any of its rows is, and the block header no longer carries the question', () => {
    render(<SetupTab {...props([row({}), row({ id: 'b', block: 'core', title: 'Entities', state: 'done', current: 'Orders' })])} />);
    expect(screen.getByRole('button', { name: 'About Goal' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'About Core Business Entities', hidden: true })).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.gy-setup-why, .gy-setup-sub')).toBeNull();
  });
  test('staged choices do not reopen or close a hint', () => {
    const { rerender } = render(<SetupTab {...props([row({})])} />);
    const btn = screen.getByRole('button', { name: 'About Business Critical Number' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    rerender(<SetupTab {...props([row({ state: 'done', current: 'Orders · profit' })], { picked: { 'goal.metric': 'b' }, savedOpen: new Set(['goal.metric']) })} />);
    expect(screen.getByRole('button', { name: 'About Business Critical Number', hidden: true })).toHaveAttribute('aria-expanded', 'true');
  });
});

test('the block tile carries the worst open severity, with an accessible name', () => {
  const { container } = render(<SetupTab {...props([row({}), row({ id: 'g2', severity: 'warning' }), row({ id: 'b', block: 'core', severity: 'warning', title: 'Entities' }), row({ id: 'c', block: 'teams', severity: 'notice', title: 'Teams' }), row({ id: 'd', block: 'metrics', state: 'done', current: 'x', title: 'Done' })])} />);
  const tile = (name: string) => container.querySelector(`.dm-collapsible[aria-label="${name}"] .dm-collapsible-icon`)!;
  expect(tile('Goal')).toHaveAttribute('data-severity', 'error');
  expect(tile('Goal')).toHaveAttribute('aria-label', '1 blocker left');
  expect(tile('Core Business Entities')).toHaveAttribute('data-severity', 'warning');
  expect(tile('Teams')).not.toHaveAttribute('data-severity');
  expect(tile('Metrics')).toHaveAttribute('aria-label', 'All set');
  expect(tile('Metrics')).toHaveAttribute('role', 'img');
  // the right side of the header holds only the chevron
  expect(container.querySelector('.dm-collapsible-actions')!.children).toHaveLength(1);
});

test('read-only shows the value or Not set and the recommendation as text, without radios, Change or Save', () => {
  render(<SetupTab {...props([row({}), row({ id: 'b', block: 'core', title: 'Entities', state: 'done', current: 'Orders' })], { readOnly: true })} />);
  expect(screen.queryByRole('radio', { hidden: true })).toBeNull();
  expect(screen.queryByRole('button', { name: /Change/, hidden: true })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  expect(screen.getByText('Recommended: Orders · revenue')).toBeInTheDocument();
  expect(screen.getByText('Orders')).toBeInTheDocument();
});

test('no AI icon anywhere, even on an AI pick', () => {
  const { container } = render(<SetupTab {...props([row({ aiPicked: true })])} />);
  expect(container.querySelector('.lucide-sparkles')).toBeNull();
});

test('the spinner shows next to the recommended tag while the AI is pending', () => {
  const { container } = render(<SetupTab {...props([row({ aiPending: true })])} />);
  expect(container.querySelector('.gy-radio .gy-spin')).not.toBeNull();
});

test('the progress bar counts what is left by severity', () => {
  render(<SetupTab {...props([row({}), row({ id: 'x', severity: 'warning' }), row({ id: 'y', severity: 'notice', state: 'done' })])} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByText('1 blocker')).toBeInTheDocument();
  expect(screen.getByText('1 recommended')).toBeInTheDocument();
  expect(screen.getByText('left')).toBeInTheDocument();
});

test('a staged append or teams pick counts as done in the bar and the block badge', () => {
  const append = { id: 'append', label: 'Add this line', recommended: true, action: { kind: 'append', scope: 'project', text: 'x' } as never };
  const r = row({ id: 'goal.description', severity: 'notice', options: [append] });
  const { rerender } = render(<SetupTab {...props([r])} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByTestId('block-count')).toHaveTextContent('1 left');
  rerender(<SetupTab {...props([r], { picked: { 'goal.description': 'append' }, dirty: 1 })} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect(screen.queryByTestId('block-count')).toBeNull();
});

describe('dismissing a notice is staged', () => {
  test('Dismiss picks, and a dismissed row offers Undo', () => {
    const p = props([row({ id: 'goal.description', severity: 'notice', dismissable: true })]);
    const { rerender } = render(<SetupTab {...p} />);
    fireEvent.click(screen.getByText('Dismiss'));
    expect(p.onPick).toHaveBeenCalledWith('goal.description', 'dismiss');
    rerender(<SetupTab {...props([row({ id: 'goal.description', severity: 'notice', dismissable: true, state: 'done' })], { picked: { 'goal.description': 'dismiss' }, savedOpen: new Set(['goal.description']) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo dismiss Business Critical Number', hidden: true }));
    expect(p.onPick).toHaveBeenCalledTimes(1);
  });
});

test('options that only open a page are link buttons, not radios', () => {
  const open = { id: 'o', label: 'Ask an admin for access', recommended: true, action: { kind: 'open', path: '/x' } as never };
  const p = props([row({ options: [open] })]);
  render(<SetupTab {...p} />);
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ask an admin for access' }));
  expect(p.onOpen).toHaveBeenCalledWith('/x');
});

test('jumping opens a folded block and a closed group, then focuses the row', async () => {
  const done = row({ id: 'a', state: 'done', current: 'Orders · revenue' });
  const open = row({ id: 'b', block: 'metrics', group: 'Orders', severity: 'warning', title: 'Orders Format' });
  render(<SetupTab {...props([done, open])} />);
  const group = document.querySelector('[data-row-id="b"]')!.closest('details')!;
  group.open = false;
  fireEvent.click(screen.getAllByRole('button', { name: /^Metrics$/, hidden: true })[0]!);
  fireEvent.click(screen.getByRole('button', { name: /recommended left/ }));
  await waitFor(() => expect(group.open).toBe(true));
  expect(document.querySelector('[data-row-id="b"]')!.closest('.dm-collapsible-clip')).toHaveAttribute('aria-hidden', 'false');
});

test('an error row has a Retry that works read-only too', () => {
  const p = props([row({ state: 'error', detail: "couldn't check" })], { readOnly: true });
  render(<SetupTab {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(p.onRetry).toHaveBeenCalled();
});

describe('progress fill', () => {
  const fill = (rows: Row[]) => { const { container } = render(<SetupTab {...props(rows)} />); return container.querySelector('.gy-progress-fill') as HTMLElement; };
  const done = (id: string, severity: Row['severity']) => row({ id, severity, state: 'done', current: 'Orders · revenue' });
  test('errors left: red, width is done/total', () => {
    const f = fill([row({}), row({ id: 'x', severity: 'warning' }), done('y', 'notice'), done('z', 'notice')]);
    expect(f).toHaveAttribute('data-severity', 'error');
    expect(f.style.width).toBe('50%');
  });
  test('warnings only: orange', () => { expect(fill([row({ severity: 'warning' }), row({ id: 'x', severity: 'notice' }), done('y', 'error')])).toHaveAttribute('data-severity', 'warning'); });
  test('notices only: notice', () => { expect(fill([row({ severity: 'notice' }), done('y', 'error')])).toHaveAttribute('data-severity', 'notice'); });
  test('all done: done at 100%', () => {
    const f = fill([done('x', 'error'), done('y', 'warning')]);
    expect(f).toHaveAttribute('data-severity', 'done');
    expect(f.style.width).toBe('100%');
  });
});

describe('the link to OWOX', () => {
  const linked = (link?: string): Option[] => [{ ...set('a', 'Orders · revenue', true), ...(link ? { link } : {}) }];
  test('the button opens the path', () => {
    const p = props([row({ options: linked('/ui/p1/data-marts/orders/data-setup?field=revenue') })]);
    render(<SetupTab {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Orders · revenue in OWOX' }));
    expect(p.onOpen).toHaveBeenCalledWith('/ui/p1/data-marts/orders/data-setup?field=revenue');
  });
  test('the label names the destination, and no onOpen means no button', () => {
    const o: Option[] = [{ ...set('a', 'Remove Orders', true), link: '/x', linkLabel: 'Orders' }];
    const { unmount } = render(<SetupTab {...props([row({ options: o })])} />);
    expect(screen.getByRole('button', { name: 'Open Orders in OWOX' })).toHaveAttribute('title', 'Open Orders in OWOX');
    unmount();
    render(<SetupTab {...props([row({ options: o })], { onOpen: undefined })} />);
    expect(screen.queryByRole('button', { name: /in OWOX/ })).toBeNull();
  });
  test('an option without a link shows no button', () => {
    render(<SetupTab {...props([row({ options: linked() })])} />);
    expect(screen.queryByRole('button', { name: /in OWOX/ })).toBeNull();
  });
});

test('each block header shows its icon tile and an open-count badge', () => {
  const done = row({ id: 'a', state: 'done', current: 'Orders · revenue' });
  const open1 = row({ id: 'b', block: 'metrics', severity: 'warning', title: 'Orders Format' });
  const open2 = row({ id: 'c', block: 'metrics', severity: 'notice', title: 'Orders Plan' });
  const { container } = render(<SetupTab {...props([done, open1, open2])} />);
  const cards = [...container.querySelectorAll('.dm-collapsible[data-variant="band"]')];
  expect(cards).toHaveLength(2);
  for (const c of cards) expect(c.querySelector('.dm-collapsible-icon svg')).not.toBeNull();
  expect(screen.getAllByTestId('block-count').map((e) => e.textContent)).toEqual(['2 left']);
});

test('a broken row with no current offers Keep the saved value and shows its detail', () => {
  render(<SetupTab {...props([row({ state: 'broken', current: null, detail: "revenue_old isn't in Orders any more" })])} />);
  expect(screen.getByText("revenue_old isn't in Orders any more")).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Keep the saved value' })).toBeChecked();
});

test('a row another pick filled in shows the matching option checked, no Not set and a note', () => {
  const r = row({ id: 'goal.aggregation', state: 'done', current: 'Sum, a total', options: [set('s', 'Sum, a total', true), set('m', 'Maximum')] });
  render(<SetupTab {...props([r], { savedOpen: new Set(['goal.aggregation']), savedRows: { 'goal.aggregation': { ...r, state: 'open', current: null } } })} />);
  expect(screen.getByRole('radio', { name: /Sum, a total/ })).toBeChecked();
  expect(screen.queryByRole('radio', { name: 'Not set' })).toBeNull();
  expect(screen.getByText('Set by your choice above')).toBeInTheDocument();
});

test('a derived value with no matching option shows a disabled checked radio', () => {
  const r = row({ state: 'done', current: 'Custom thing' });
  render(<SetupTab {...props([r], { savedOpen: new Set(['goal.metric']) })} />);
  const radio = screen.getByRole('radio', { name: 'Custom thing' });
  expect(radio).toBeChecked();
  expect(radio).toBeDisabled();
});

test('picking the last open row of a group keeps the group open and the block unfolded', () => {
  const open = row({ id: 'b', block: 'metrics', group: 'Orders', severity: 'warning', title: 'Orders Format' });
  const { rerender } = render(<SetupTab {...props([open])} />);
  const group = document.querySelector('[data-row-id="b"]')!.closest('details')!;
  expect(group.open).toBe(true);
  rerender(<SetupTab {...props([{ ...open, state: 'done', current: 'Orders · revenue' }], { savedOpen: new Set(['b']), picked: { b: 'a' } })} />);
  expect(document.querySelector('[data-row-id="b"]')!.closest('details')!.open).toBe(true);
  expect(document.querySelector('[data-row-id="b"]')!.closest('.dm-collapsible')).toHaveAttribute('data-folded', 'false');
});

test('a row that appears because of a pick is unset: radios and an open hint', () => {
  const { rerender } = render(<SetupTab {...props([row({ state: 'done', current: 'x' })], { savedOpen: new Set() })} />);
  const fresh = row({ id: 'new', block: 'metrics', title: 'Fresh Row' });
  rerender(<SetupTab {...props([row({ state: 'done', current: 'x' }), fresh], { savedOpen: new Set(['new']) })} />);
  expect(screen.getByRole('radiogroup', { name: 'Fresh Row' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'About Fresh Row' })).toHaveAttribute('aria-expanded', 'true');
});

test('a link-only row shows no radios and no Change, just the value and the links', () => {
  const open = { id: 'o', label: 'Ask an admin for access', recommended: true, action: { kind: 'open', path: '/x' } as never };
  render(<SetupTab {...props([row({ options: [open] })])} />);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('radiogroup')).toBeNull();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  const done = row({ id: 'z', block: 'core', title: 'Done link row', state: 'done', current: 'OK', options: [open] });
  render(<SetupTab {...props([done])} />);
  expect(screen.queryByRole('button', { name: /Change/, hidden: true })).toBeNull();
});

test('a staged ratio add stays checked from the saved options, and Not set undoes it', () => {
  const saved = row({ id: 'ratio:x', block: 'ratios', title: 'a per b', severity: 'notice', options: [set('ratio:add', 'Add a per b', true), set('ratio:skip', 'Skip this ratio')] });
  const draft = row({ id: 'ratio:x', block: 'ratios', title: 'a per b', severity: 'notice', state: 'done', current: 'a per b', options: [{ ...set('ratio:keep', 'Keep this ratio'), keep: true }, set('ratio:remove', 'Remove this ratio')] });
  const p = props([draft], { picked: { 'ratio:x': 'ratio:add' }, savedRows: { 'ratio:x': saved }, savedOpen: new Set(['ratio:x']) });
  render(<SetupTab {...p} />);
  expect(screen.getByRole('radio', { name: /Add a per b/ })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
  expect(p.onPick).toHaveBeenCalledWith('ratio:x', null);
});

test('a keep option is the default radio instead of a generic Keep', () => {
  const keep = { ...set('ratio:keep', 'Keep this ratio'), keep: true };
  const r = row({ state: 'broken', current: 'a per b', options: [set('ratio:remove', 'Remove this ratio', true), keep] });
  render(<SetupTab {...props([r])} />);
  expect(screen.getByRole('radio', { name: 'Keep this ratio' })).toBeChecked();
  expect(screen.queryByRole('radio', { name: /^Keep a per b/ })).toBeNull();
});

test('the checked option shows even behind Show more, Show more sits outside the group, and saving disables the radios', () => {
  const opts = [set('a', 'A1', true), set('b', 'B1'), set('c', 'C1'), set('d', 'D1')];
  render(<SetupTab {...props([row({ options: opts })], { picked: { 'goal.metric': 'd' }, saving: true })} />);
  const group = screen.getByRole('radiogroup');
  expect(within(group).getByRole('radio', { name: 'D1' })).toBeChecked();
  expect(within(group).queryByRole('button')).toBeNull();
  for (const r of within(group).getAllByRole('radio')) expect(r).toBeDisabled();
});

test('read-only keeps the external link next to the recommendation', () => {
  const o: Option = { ...set('a', 'Orders · revenue', true), link: '/x', linkLabel: 'Orders · revenue' };
  const p = props([row({ options: [o] })], { readOnly: true });
  render(<SetupTab {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open Orders · revenue in OWOX' }));
  expect(p.onOpen).toHaveBeenCalledWith('/x');
});
