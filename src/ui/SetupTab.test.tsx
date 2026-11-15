import { describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SetupSaveControls, SetupTab, type SetupTabProps } from './SetupTab';
import type { Option, Row } from '../setup/types';

const set = (id: string, label: string, recommended = false): Option => ({ id, label, recommended, action: { kind: 'set', next: (s) => s } });
const row = (over: Partial<Row>): Row => ({ id: 'goal.metric', block: 'goal', title: 'Business Critical Number', question: 'What is the main business goal?', why: 'Every card is judged by how it moves this number.', severity: 'error', state: 'open', current: null, aiPending: false, dismissable: false,
  options: [set('a', 'Orders · revenue', true), set('b', 'Orders · profit')], ...over });
const props = (rows: Row[], over: Partial<SetupTabProps> = {}): SetupTabProps => ({ rows, loading: false, readOnly: false, message: null, picked: {}, onPick: vi.fn(), dirty: 0, saving: false, onSave: vi.fn(), onDiscard: vi.fn(), savedOpen: new Set(rows.filter((r) => r.state !== 'done').map((r) => r.id)), onRetry: vi.fn(), onOpen: vi.fn(), ...over });
const four = [set('a', 'Orders · revenue'), set('b', 'Orders · profit'), set('c', 'Orders · items', true), set('d', 'Orders · tax')];

test('an unset row is a radio group: Not set checked, the recommended option first and tagged, the rest behind Show more', () => {
  render(<SetupTab {...props([row({ options: four })])} />);
  const group = screen.getByRole('radiogroup', { name: 'Business Critical Number' });
  const radios = within(group).getAllByRole('radio');
  expect(radios.map((r) => (r as HTMLInputElement).labels![0]!.textContent)).toEqual(['Not set', 'Orders · itemsRecommended', 'Orders · revenue', 'Orders · profit']);
  expect(radios[0]).toBeChecked();
  expect(within(group).getByText('Recommended')).toHaveClass('gy-row-rec');
  expect(within(group).queryByRole('radio', { name: /tax/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
  expect(within(group).getByRole('radio', { name: /tax/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
});

function Stateful({ rows }: { rows: Row[] }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const live = rows.map((r) => (picked[r.id] ? { ...r, state: 'done' as const } : r));
  const onPick = (id: string, o: string | null) => setPicked((p) => { const n = { ...p }; if (o === null) delete n[id]; else n[id] = o; return n; });
  const p = props(live, { picked, onPick, dirty: Object.keys(picked).length, savedOpen: new Set(rows.map((r) => r.id)) });
  return <><SetupSaveControls {...p} /><SetupTab {...p} /></>;
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
  const { rerender } = render(<SetupSaveControls {...p} />);
  expect(screen.getByText('2 changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(p.onSave).toHaveBeenCalledTimes(1);
  expect(p.onDiscard).toHaveBeenCalledTimes(1);
  rerender(<SetupSaveControls {...props([row({})], { dirty: 2, saving: true })} />);
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
});

test('a set row shows its value and an Edit pencil, which opens the radios with Keep <value> checked', () => {
  const done = row({ state: 'done', current: 'Orders · revenue' });
  render(<SetupTab {...props([done])} />);
  expect(screen.getByText('Orders · revenue')).toBeInTheDocument();
  expect(screen.queryByRole('radio', { hidden: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  expect(screen.getByRole('radio', { name: /^Keep Orders · revenue/, hidden: true })).toBeChecked();
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
  expect(screen.queryByRole('button', { name: /Edit/, hidden: true })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  expect(screen.getByText('Recommended: Orders · revenue')).toBeInTheDocument();
  expect(screen.getByText('Orders')).toBeInTheDocument();
});

test('no AI icon anywhere', () => {
  const { container } = render(<SetupTab {...props([row({})])} />);
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

describe('dismissing a notice is a Not needed radio', () => {
  const notice = (over: Partial<Row> = {}) => row({ id: 'goal.description', severity: 'notice', dismissable: true, ...over });
  const labels = () => within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels![0]!.textContent);

  test('Not needed is the last visible radio, before Show more, and picking it stages dismiss', () => {
    const p = props([notice({ options: four })]);
    render(<SetupTab {...p} />);
    expect(labels().at(-1)).toBe('Not needed');
    expect(screen.queryByText('Dismiss')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Not needed' }));
    expect(p.onPick).toHaveBeenCalledWith('goal.description', 'dismiss');
  });

  test('a staged dismiss checks Not needed, and Not set undoes it', () => {
    const p = props([notice()], { picked: { 'goal.description': 'dismiss' } });
    render(<SetupTab {...p} />);
    expect(screen.getByRole('radio', { name: 'Not needed' })).toBeChecked();
    expect(screen.queryByText(/Dismissed|Undo/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
    expect(p.onPick).toHaveBeenCalledWith('goal.description', null);
  });

  test('a row with its own no option gets no extra Not needed', () => {
    render(<SetupTab {...props([notice({ options: [set('a', 'Orders · revenue'), { ...set('none', 'No plan yet'), declines: true }] })])} />);
    expect(labels()).not.toContain('Not needed');
  });

  test('a non-dismissable row and a read-only viewer get none', () => {
    const { unmount } = render(<SetupTab {...props([row({})])} />);
    expect(screen.queryByRole('radio', { name: 'Not needed' })).toBeNull();
    unmount();
    render(<SetupTab {...props([notice()], { readOnly: true })} />);
    expect(screen.queryByRole('radio')).toBeNull();
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
  test('the link icon carries the hover-reveal class', () => {
    const o: Option[] = [{ ...set('a', 'Remove Orders', true), link: '/x', linkLabel: 'Orders' }];
    render(<SetupTab {...props([row({ options: o })])} />);
    expect(screen.getByRole('button', { name: 'Open Orders in OWOX' })).toHaveClass('gy-row-link-reveal');
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
  render(<SetupTab {...props([r], { savedOpen: new Set(['goal.aggregation']) })} />);
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

test('a link-only row shows no radios and no Edit pencil, just the value and the links', () => {
  const open = { id: 'o', label: 'Ask an admin for access', recommended: true, action: { kind: 'open', path: '/x' } as never };
  render(<SetupTab {...props([row({ options: [open] })])} />);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('radiogroup')).toBeNull();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  const done = row({ id: 'z', block: 'core', title: 'Done link row', state: 'done', current: 'OK', options: [open] });
  render(<SetupTab {...props([done])} />);
  expect(screen.queryByRole('button', { name: /Edit/, hidden: true })).toBeNull();
});

test('a staged ratio add stays checked from the saved options, and Not set undoes it', () => {
  const saved = row({ id: 'ratio:x', block: 'ratios', title: 'a per b', severity: 'notice', options: [set('ratio:add', 'Add a per b', true), set('ratio:skip', 'Skip this ratio')] });
  const draft = row({ id: 'ratio:x', block: 'ratios', title: 'a per b', severity: 'notice', state: 'done', current: 'a per b', options: [{ ...set('ratio:keep', 'Keep this ratio'), keep: true }, set('ratio:remove', 'Remove this ratio')] });
  const p = props([draft], { picked: { 'ratio:x': 'ratio:add' }, optionRows: { 'ratio:x': saved }, savedOpen: new Set(['ratio:x']) });
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

test('Add can switch straight to Skip: the radios come from the row the pick ran against', () => {
  const pair = row({ id: 'ratio:x', block: 'ratios', title: 'a per b', severity: 'notice', options: [set('ratio:add', 'Add a per b', true), set('ratio:skip', 'Skip this ratio')] });
  const draft = row({ id: 'ratio:x', block: 'ratios', title: 'a per b', severity: 'notice', state: 'done', current: 'a per b', options: [{ ...set('ratio:keep', 'Keep this ratio'), keep: true }, set('ratio:remove', 'Remove this ratio')] });
  const p = props([draft], { picked: { 'ratio:x': 'ratio:add' }, optionRows: { 'ratio:x': pair }, savedOpen: new Set(['ratio:x']) });
  render(<SetupTab {...p} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Skip this ratio' }));
  expect(p.onPick).toHaveBeenCalledWith('ratio:x', 'ratio:skip');
});

test('rows that exist only in the draft open their block and seed its hint open', () => {
  const goal = row({ state: 'done', current: 'x' });
  const { rerender, container } = render(<SetupTab {...props([goal], { savedOpen: new Set() })} />);
  const a = row({ id: 'm1', block: 'metrics', title: 'Fresh One' });
  const b = row({ id: 'c1', block: 'core', title: 'Core One', state: 'done', current: 'y' });
  rerender(<SetupTab {...props([goal, b, a], { savedOpen: new Set(['m1']) })} />);
  const card = (name: string) => container.querySelector(`.dm-collapsible[aria-label="${name}"]`)!;
  expect(card('Metrics')).toHaveAttribute('data-folded', 'false');
  expect(screen.getByRole('button', { name: 'About Metrics' })).toHaveAttribute('aria-expanded', 'true');
  expect(card('Core Business Entities')).toHaveAttribute('data-folded', 'true');
  // a folded block gains an unset row
  rerender(<SetupTab {...props([goal, { ...b, state: 'open', current: null }, a], { savedOpen: new Set(['m1', 'c1']) })} />);
  expect(card('Core Business Entities')).toHaveAttribute('data-folded', 'false');
});

test('a Data Mart group shows the mart icon, the default when it has none', () => {
  const rows = [row({ id: 'class:orders.key', block: 'metrics', group: 'Orders', groupId: 'orders' }), row({ id: 'class:ads.key', block: 'metrics', group: 'Ads', groupId: 'ads' })];
  const { container } = render(<SetupTab {...props(rows, { martIcons: { orders: 'orders', ads: null } })} />);
  const [orders, ads] = [...container.querySelectorAll('details.gy-setup-group')];
  expect(orders!.querySelector('summary .gy-setup-group-icon svg')).toHaveClass('lucide-receipt');
  expect(ads!.querySelector('summary .gy-setup-group-icon svg')).toHaveClass('lucide-box');
});

test('the Setup hint bubble carries gy-hintbox, never the canvas gy-hint', () => {
  const { container } = render(<SetupTab {...props([row({})])} />);
  const bubbles = container.querySelectorAll('.gy-hintbox');
  expect(bubbles.length).toBeGreaterThan(0);
  expect(container.querySelector('.gy-hint')).toBeNull();
  expect(container.querySelector('[class*="gy-hint "], [class$="gy-hint"]')).toBeNull();
});

test('a link-only notice offers Not set and Not needed next to its link, and Not needed stages a dismiss', () => {
  const onPick = vi.fn();
  const open: Option = { id: 'none', label: 'Add a Data Mart', recommended: true, action: { kind: 'open', path: '/x' } };
  const rows = [row({ severity: 'notice', dismissable: true, options: [open] })];
  const { rerender } = render(<SetupTab {...props(rows, { onPick })} />);
  const group = screen.getByRole('radiogroup', { name: 'Business Critical Number' });
  const radios = within(group).getAllByRole('radio');
  expect(radios.map((r) => (r as HTMLInputElement).labels![0]!.textContent)).toEqual(['Not set', 'Not needed']);
  expect(radios[0]).toBeChecked();
  expect(screen.getByRole('button', { name: 'Add a Data Mart' })).toBeInTheDocument();
  fireEvent.click(radios[1]!);
  expect(onPick).toHaveBeenCalledWith('goal.metric', 'dismiss');
  rerender(<SetupTab {...props(rows, { onPick, picked: { 'goal.metric': 'dismiss' } })} />);
  expect(within(group).getAllByRole('radio')[1]).toBeChecked();
  fireEvent.click(within(group).getAllByRole('radio')[0]!);
  expect(onPick).toHaveBeenLastCalledWith('goal.metric', null);
});

test('a set row leaves its saved value out of the Edit list, so it is only "Keep"', () => {
  const r = row({ state: 'done', current: '20%', options: [set('t:20', '20%', true), set('t:10', '10%')] });
  render(<SetupTab {...props([r], { savedOpen: new Set() })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  const labels = within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true }).map((x) => (x as HTMLInputElement).labels![0]!.textContent);
  expect(labels).toEqual(['Keep 20%Recommended', '10%']);
});

test('a link-only notice saved as Not needed shows the pencil, with Not needed checked and Not set staging an undismiss', () => {
  const onPick = vi.fn();
  const open: Option = { id: 'none', label: 'Add a Data Mart', recommended: true, action: { kind: 'open', path: '/x' } };
  const r = row({ severity: 'notice', dismissable: true, state: 'done', current: 'Not needed', dismissed: true, options: [open] });
  render(<SetupTab {...props([r], { savedOpen: new Set(), onPick })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  const radios = within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true });
  expect(radios.map((x) => (x as HTMLInputElement).labels![0]!.textContent)).toEqual(['Not needed', 'Not set']);
  expect(radios[0]).toBeChecked();
  expect(screen.getByRole('button', { name: 'Add a Data Mart', hidden: true })).toBeInTheDocument();
  fireEvent.click(radios[1]!);
  expect(onPick).toHaveBeenCalledWith('goal.metric', 'undismiss');
});

test('a dismissed row hides the options that decline, so "No plan yet" does not repeat "Not needed"', () => {
  const none: Option = { ...set('none', 'No plan yet'), declines: true };
  const r = row({ state: 'done', current: 'Not needed', dismissed: true, options: [set('a', 'Orders · plan', true), none] });
  render(<SetupTab {...props([r], { savedOpen: new Set() })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  const labels = within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true }).map((x) => (x as HTMLInputElement).labels![0]!.textContent);
  expect(labels).toEqual(['Not needed', 'Not set', 'Orders · planRecommended']);
});

test('a dismissed notice reads Not needed, checked on Edit', () => {
  const r = row({ severity: 'notice', dismissable: true, state: 'done', current: 'Not needed', dismissed: true });
  render(<SetupTab {...props([r], { savedOpen: new Set() })} />);
  expect(screen.getByText('Not needed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  const radios = within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true });
  expect(radios.map((x) => (x as HTMLInputElement).labels![0]!.textContent)).toEqual(['Not needed', 'Not set', 'Orders · revenueRecommended', 'Orders · profit']);
  expect(radios[0]).toBeChecked();
});

test('Edit closes once a save lands', () => {
  const r = row({ state: 'done', current: 'Orders · revenue' });
  const { rerender } = render(<SetupTab {...props([r], { savedOpen: new Set(), saveCount: 0 })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  expect(screen.getByRole('radiogroup', { hidden: true })).toBeInTheDocument();
  rerender(<SetupTab {...props([r], { savedOpen: new Set(), saveCount: 1 })} />);
  expect(screen.queryByRole('radiogroup', { hidden: true })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true })).toBeInTheDocument();
});

describe('the radio list follows the row the pick ran against', () => {
  const labels = () => within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true }).map((x) => (x as HTMLInputElement).labels![0]!.textContent);
  const checked = () => within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true }).filter((x) => (x as HTMLInputElement).checked).map((x) => (x as HTMLInputElement).labels![0]!.textContent);
  const change = () => fireEvent.click(screen.getByRole('button', { name: 'Edit Business Critical Number', hidden: true }));
  const none: Option = { ...set('none', 'No plan yet'), declines: true };

  test('a saved plan staged to "No plan yet" still offers Keep, the options and the checked "No plan yet"', () => {
    const was = row({ state: 'done', current: 'Orders · plan', options: [set('a', 'Orders · plan', true), set('b', 'Orders · other'), none] });
    const live = { ...was, current: 'Not needed', dismissed: true as const };
    render(<SetupTab {...props([live], { savedOpen: new Set(), optionRows: { [was.id]: was }, picked: { [was.id]: 'none' } })} />);
    change();
    expect(labels()).toEqual(['Keep Orders · planRecommended', 'Orders · other', 'No plan yet']);
    expect(checked()).toEqual(['No plan yet']);
  });

  test('a saved Not needed staged to a real option keeps "Not needed" as the keep radio and hides "No plan yet"', () => {
    const was = row({ state: 'done', current: 'Not needed', dismissed: true, options: [set('a', 'Orders · plan', true), set('b', 'Orders · other'), none] });
    const live = { ...was, current: 'Orders · plan', dismissed: undefined };
    render(<SetupTab {...props([live], { savedOpen: new Set(), optionRows: { [was.id]: was }, picked: { [was.id]: 'b' } })} />);
    change();
    expect(labels()).toEqual(['Not needed', 'Not set', 'Orders · planRecommended', 'Orders · other']);
    expect(checked()).toEqual(['Orders · other']);
  });

  test('a skipped ratio staged to Add keeps "Skipped", checks "Add" and has no "Skip this ratio"', () => {
    const skip: Option = { ...set('ratio:skip', 'Skip this ratio'), declines: true };
    const was = row({ state: 'done', current: 'Skipped', dismissed: true, options: [set('ratio:add', 'Add A per B', true), skip] });
    const live = { ...was, current: 'A per B', dismissed: undefined, options: [set('ratio:keep', 'Keep this ratio', true), set('ratio:remove', 'Remove this ratio')] };
    render(<SetupTab {...props([live], { savedOpen: new Set(), optionRows: { [was.id]: was }, picked: { [was.id]: 'ratio:add' } })} />);
    change();
    expect(labels()).toEqual(['Skipped', 'Not set', 'Add A per BRecommended']);
    expect(checked()).toEqual(['Add A per BRecommended']);
  });

  test('a link-only notice saved Not needed and staged to Not set keeps its radios, and Not needed undoes it', () => {
    const open: Option = { id: 'none', label: 'Add a Data Mart', recommended: true, action: { kind: 'open', path: '/x' } };
    const onPick = vi.fn();
    const was = row({ severity: 'notice', dismissable: true, state: 'done', current: 'Not needed', dismissed: true, options: [open] });
    const live = { ...was, state: 'open' as const, current: null, dismissed: undefined };
    render(<SetupTab {...props([live], { savedOpen: new Set(), optionRows: { [was.id]: was }, picked: { [was.id]: 'undismiss' }, onPick })} />);
    change();
    expect(labels()).toEqual(['Not needed', 'Not set']);
    expect(checked()).toEqual(['Not set']);
    fireEvent.click(within(screen.getByRole('radiogroup', { hidden: true })).getAllByRole('radio', { hidden: true })[0]!);
    expect(onPick).toHaveBeenCalledWith(was.id, null);
  });

  test('two options with the saved label: only the first is hidden', () => {
    const r = row({ state: 'done', current: '20%', options: [set('t:20', '20%', true), set('t:20b', '20%'), set('t:10', '10%')] });
    render(<SetupTab {...props([r], { savedOpen: new Set() })} />);
    change();
    expect(labels()).toEqual(['Keep 20%Recommended', '20%', '10%']);
  });
});

test('with a progress slot, the save message and the notice go into the slot beside the bar', () => {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  render(<SetupTab {...props([row({ state: 'done', current: 'x' })], { message: 'Save failed', notice: 'A later pick replaced one', progressSlot: slot })} />);
  expect(within(slot).getByText('Save failed')).toBeInTheDocument();
  expect(within(slot).getByText('A later pick replaced one')).toBeInTheDocument();
  slot.remove();
});
