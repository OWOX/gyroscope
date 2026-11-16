import { readFileSync } from 'node:fs';
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

describe('tooltips', () => {
  const tipOf = (btn: HTMLElement) => document.getElementById(btn.getAttribute('aria-controls')!);
  test('every (?) starts closed, opens on click, closes on a second click, Escape or a click outside', () => {
    const { container } = render(<SetupTab {...props([row({}), row({ id: 'b', title: 'Entities', state: 'done', current: 'Orders' })])} />);
    const btn = screen.getByRole('button', { name: 'About Business Critical Number' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'About Goal & Core Classes' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const tip = tipOf(btn)!;
    expect(tip).toHaveAttribute('role', 'tooltip');
    expect(tip).toHaveTextContent('What is the main business goal? Every card is judged by how it moves this number.');
    // portalled out of the block: it is never in the document flow
    expect(container.querySelector('.dm-collapsible')!.contains(tip)).toBe(false);
    expect(tip.closest('.dm-collapsible-clip')).toBeNull();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(btn);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  test('hovering or focusing the (?) opens nothing', () => {
    render(<SetupTab {...props([row({})])} />);
    const btn = screen.getByRole('button', { name: 'About Business Critical Number' });
    fireEvent.mouseEnter(btn); fireEvent.focus(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  test('a new unset row has no tooltip open, and there are no in-flow hint boxes', () => {
    const { container } = render(<SetupTab {...props([row({ state: 'done', current: 'x' }), row({ id: 'new', block: 'metrics', title: 'Fresh Row' })])} />);
    expect(screen.getByRole('button', { name: 'About Fresh Row' })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.gy-hintbox, .gy-hint')).toBeNull();
  });
  test('opening one tooltip closes another', () => {
    render(<SetupTab {...props([row({}), row({ id: 'b', title: 'Other', options: [set('x', 'X')] })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'About Business Critical Number' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'About Other' }));
    fireEvent.click(screen.getByRole('button', { name: 'About Other' }));
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  });
  test('a long description with a page link is clamped, with Show more opening the page; short or link-less text has none', () => {
    const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500);
    const onOpen = vi.fn();
    const rows = [row({ id: 'team:m.metric', block: 'teams', group: 'Marketing', groupLink: '/ui/p/project-settings/contexts?context=m', groupDescription: 'Long text', state: 'done', current: 'x' })];
    const { unmount } = render(<SetupTab {...props(rows, { onOpen, savedOpen: new Set(['team:m.metric']) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'About Marketing' }));
    expect(document.querySelector('.gy-tip-content')).toHaveAttribute('data-clamp');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onOpen).toHaveBeenCalledWith('/ui/p/project-settings/contexts?context=m');
    expect(screen.queryByRole('tooltip')).toBeNull();
    unmount();
    render(<SetupTab {...props(rows.map((r) => ({ ...r, groupLink: undefined })), { onOpen, savedOpen: new Set(['team:m.metric']) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'About Marketing' }));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(document.querySelector('.gy-tip-content')).not.toHaveAttribute('data-clamp');
    sh.mockRestore();
  });
  test('the clamp is cut at the bottom of the last whole line, so no half line shows above Show more', () => {
    const spies = [
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500),
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100),
      vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([18, 36, 54, 72, 90, 108].map((bottom) => ({ top: bottom - 18, bottom })) as never),
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    ];
    render(<SetupTab {...props([row({ id: 'team:m.metric', block: 'teams', group: 'Marketing', groupLink: '/x', groupDescription: 'Long text', state: 'done', current: 'x' })], { savedOpen: new Set(['team:m.metric']) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'About Marketing' }));
    expect((document.querySelector('.gy-tip-content') as HTMLElement).style.maxHeight).toBe('90px');
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    spies.forEach((x) => x.mockRestore());
  });
  test('a tooltip that fits shows no Show more', () => {
    render(<SetupTab {...props([row({ id: 'team:m.metric', block: 'teams', group: 'Marketing', groupLink: '/x', groupDescription: 'Short', state: 'done', current: 'x' })], { savedOpen: new Set(['team:m.metric']) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'About Marketing' }));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

test('the block tile carries the worst open severity, with an accessible name', () => {
  const { container } = render(<SetupTab {...props([row({}), row({ id: 'g2', severity: 'warning' }), row({ id: 'b', block: 'ratios', severity: 'warning', title: 'Entities' }), row({ id: 'c', block: 'teams', severity: 'notice', title: 'Contexts' }), row({ id: 'd', block: 'metrics', state: 'done', current: 'x', title: 'Done' })])} />);
  const tile = (name: string) => container.querySelector(`.dm-collapsible[aria-label="${name}"] .dm-collapsible-icon`)!;
  expect(tile('Goal & Core Classes')).toHaveAttribute('data-severity', 'error');
  expect(tile('Goal & Core Classes')).toHaveAttribute('aria-label', '1 blocker left');
  expect(tile('Ratio Metrics')).toHaveAttribute('data-severity', 'warning');
  expect(tile('Contexts')).not.toHaveAttribute('data-severity');
  expect(tile('Metrics')).toHaveAttribute('aria-label', 'All set');
  expect(tile('Metrics')).toHaveAttribute('role', 'img');
  // the right side of the header holds only the chevron
  expect(container.querySelector('.dm-collapsible-actions')!.children).toHaveLength(1);
});

test('read-only shows the value or Not set and the recommendation as text, without radios, Change or Save', () => {
  render(<SetupTab {...props([row({}), row({ id: 'b', block: 'goal', title: 'Entities', state: 'done', current: 'Orders' })], { readOnly: true })} />);
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
  expect(screen.queryByTestId('block-count')).toBeNull();
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

test('each block header shows its icon tile and no count badge', () => {
  const done = row({ id: 'a', state: 'done', current: 'Orders · revenue' });
  const open1 = row({ id: 'b', block: 'metrics', severity: 'warning', title: 'Orders Format' });
  const open2 = row({ id: 'c', block: 'metrics', severity: 'notice', title: 'Orders Plan' });
  const { container } = render(<SetupTab {...props([done, open1, open2])} />);
  const cards = [...container.querySelectorAll('.dm-collapsible[data-variant="band"]')];
  expect(cards).toHaveLength(2);
  for (const c of cards) expect(c.querySelector('.dm-collapsible-icon svg')).not.toBeNull();
  expect(screen.queryByTestId('block-count')).toBeNull();
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

test('a row that appears because of a pick is unset: radios', () => {
  const { rerender } = render(<SetupTab {...props([row({ state: 'done', current: 'x' })], { savedOpen: new Set() })} />);
  const fresh = row({ id: 'new', block: 'metrics', title: 'Fresh Row' });
  rerender(<SetupTab {...props([row({ state: 'done', current: 'x' }), fresh], { savedOpen: new Set(['new']) })} />);
  expect(screen.getByRole('radiogroup', { name: 'Fresh Row' })).toBeInTheDocument();
});

test('a link-only row shows no radios and no Edit pencil, just the value and the links', () => {
  const open = { id: 'o', label: 'Ask an admin for access', recommended: true, action: { kind: 'open', path: '/x' } as never };
  render(<SetupTab {...props([row({ options: [open] })])} />);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('radiogroup')).toBeNull();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  const done = row({ id: 'z', block: 'goal', title: 'Done link row', state: 'done', current: 'OK', options: [open] });
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

test('rows that exist only in the draft open their block', () => {
  const goal = row({ state: 'done', current: 'x' });
  const { rerender, container } = render(<SetupTab {...props([goal], { savedOpen: new Set() })} />);
  const a = row({ id: 'm1', block: 'metrics', title: 'Fresh One' });
  const b = row({ id: 'c1', block: 'ratios', title: 'Core One', state: 'done', current: 'y' });
  rerender(<SetupTab {...props([goal, b, a], { savedOpen: new Set(['m1']) })} />);
  const card = (name: string) => container.querySelector(`.dm-collapsible[aria-label="${name}"]`)!;
  expect(card('Metrics')).toHaveAttribute('data-folded', 'false');
  expect(card('Ratio Metrics')).toHaveAttribute('data-folded', 'true');
  // a folded block gains an unset row
  rerender(<SetupTab {...props([goal, { ...b, state: 'open', current: null }, a], { savedOpen: new Set(['m1', 'c1']) })} />);
  expect(card('Ratio Metrics')).toHaveAttribute('data-folded', 'false');
});

test('a Data Mart group shows the mart icon, the default when it has none', () => {
  const rows = [row({ id: 'class:orders.key', block: 'metrics', group: 'Orders', groupId: 'orders' }), row({ id: 'class:ads.key', block: 'metrics', group: 'Ads', groupId: 'ads' })];
  const { container } = render(<SetupTab {...props(rows, { martIcons: { orders: 'orders', ads: null } })} />);
  const [orders, ads] = [...container.querySelectorAll('details.gy-setup-group')];
  expect(orders!.querySelector('summary .gy-setup-group-icon svg')).toHaveClass('lucide-receipt');
  expect(ads!.querySelector('summary .gy-setup-group-icon svg')).toHaveClass('lucide-box');
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

describe('an option that points at a Data Mart', () => {
  const rec = { ...set('f', 'Orders · revenue', true), martId: 'orders', link: '/ui/p/data-marts/orders/data-setup', linkLabel: 'Orders · revenue' };
  const plain = set('g', 'Orders · profit');
  const r = row({ options: [rec, plain] });

  test('shows the mart icon, then the label, the Recommended pill and the link, in that order', () => {
    render(<SetupTab {...props([r], { martIcons: { orders: 'orders' } })} />);
    const label = document.querySelector('label[for$="-f"]')!;
    expect(label.querySelector('svg.lucide-receipt')).not.toBeNull();
    const order = [...label.querySelectorAll('svg.lucide-receipt, .gy-row-link, .gy-row-rec')];
    expect(order.map((e) => (e.matches('svg') ? 'icon' : e.matches('.gy-row-link') ? 'link' : 'pill'))).toEqual(['icon', 'pill', 'link']);
    expect(label.firstElementChild!.matches('svg.lucide-receipt')).toBe(true);
    expect(label.textContent).toContain('Orders · revenue');
    const name = screen.getByRole('radio', { name: 'Orders · revenue Recommended' });
    expect(name.getAttribute('id')).toBe(label.getAttribute('for'));
    expect(screen.queryByRole('radio', { name: /Open/ })).toBeNull();
    // an option without a Data Mart has no icon and no reserved width
    expect(document.querySelector('label[for$="-g"] svg')).toBeNull();
    expect(document.querySelector('label[for$="-g"] .gy-opt-gap')).toBeNull();
  });

  test('clicking the link inside a label opens the page and leaves the radio unchecked', () => {
    const p = props([r], { martIcons: { orders: 'orders' } });
    render(<SetupTab {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Orders · revenue in OWOX' }));
    expect(p.onOpen).toHaveBeenCalledWith('/ui/p/data-marts/orders/data-setup');
    // (happy-dom fires a label's activation for a nested button; real browsers don't, checked in Chromium)
    expect((screen.getByRole('radio', { name: 'Orders · revenue Recommended' }) as HTMLInputElement).checked).toBe(false);
  });
});

describe('a long option list gets a search', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => set(`o${i}`, i === 7 ? 'Orders · Gross Sales' : `Orders · field ${i}`));
  const group = () => screen.getByRole('radiogroup', { name: 'Business Critical Number' });

  test('20 options show 3 radios and a search, not Show more', () => {
    render(<SetupTab {...props([row({ options: many(20) })])} />);
    expect(within(group()).getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Search 17 more…');
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });

  test('typing filters by label, Enter stages the pick, the picked option shows checked', () => {
    const onPick = vi.fn();
    const { rerender } = render(<SetupTab {...props([row({ options: many(20) })], { onPick })} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'gross' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Orders · Gross Sales']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('goal.metric', 'o7');
    expect(box).toHaveValue('');
    rerender(<SetupTab {...props([row({ options: many(20) })], { onPick, picked: { 'goal.metric': 'o7' } })} />);
    expect(within(group()).getByRole('radio', { name: 'Orders · Gross Sales' })).toBeChecked();
  });

  test('an empty field suggests 8, arrows move the active option, Escape closes', () => {
    render(<SetupTab {...props([row({ options: many(20) })])} />);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(8);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  test('11 options keep Show more, 12 get the search', () => {
    const { unmount } = render(<SetupTab {...props([row({ options: many(11) })])} />);
    expect(screen.getByRole('button', { name: 'Show 8 more' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    unmount();
    render(<SetupTab {...props([row({ options: many(12) })])} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('10 options keep Show 7 more', () => {
    render(<SetupTab {...props([row({ options: many(10) })])} />);
    expect(screen.getByRole('button', { name: 'Show 7 more' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('the option search dropdown', () => {
  const many = Array.from({ length: 20 }, (_, i) => set(`o${i}`, `Orders · field ${i}`));
  const mount = (over: Partial<SetupTabProps> = {}) => render(<SetupTab {...props([row({ options: many })], over)} />);

  test('a mouse pick from the list stages the pick', () => {
    const onPick = vi.fn();
    mount({ onPick });
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.mouseDown(screen.getAllByRole('option')[2]!);
    expect(onPick).toHaveBeenCalledWith('goal.metric', 'o5');
  });

  test('blur closes the list', () => {
    mount();
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(box);
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  test('while saving the input is disabled and the list closed, and an open list closes', () => {
    const { rerender } = mount();
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    rerender(<SetupTab {...props([row({ options: many })], { saving: true })} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  test('read-only has no combobox (and no option list at all)', () => {
    mount({ readOnly: true });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
  });

  test('a click reopens the list after Escape', () => {
    mount();
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
  });

  test('a query that matches nothing shows No matches, not a listbox option', () => {
    mount();
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('layout', () => {
  test('the Contexts and Metrics blocks lay their groups out as bordered cells in a grid; other blocks keep a single column', () => {
    const rows = [row({ id: 'team:a.metric', block: 'teams', group: 'Sales' }), row({ id: 'team:b.metric', block: 'teams', group: 'Marketing' }), row({ id: 'class:o.key', block: 'metrics', group: 'Orders', title: 'Orders Headline Number' })];
    const { container } = render(<SetupTab {...props(rows)} />);
    const grid = container.querySelector('.dm-collapsible[aria-label="Contexts"] .gy-setup-groups')!;
    expect(grid.querySelectorAll(':scope > details.gy-setup-group')).toHaveLength(2);
    const metrics = container.querySelector('.dm-collapsible[aria-label="Metrics"] .gy-setup-groups')!;
    expect(metrics.querySelectorAll(':scope > details.gy-setup-cell')).toHaveLength(1);
    expect(metrics.querySelector('.gy-row-title-plain')!.textContent).toBe('Headline Number');
  });

  test('the option list is portalled out of the collapsible clip', () => {
    const many = Array.from({ length: 20 }, (_, i) => set(`o${i}`, `Orders · field ${i}`));
    const { container } = render(<SetupTab {...props([row({ options: many })])} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'field' } });
    const list = screen.getByRole('listbox');
    expect(list.closest('.dm-collapsible-clip')).toBeNull();
    expect(list.closest('.gy-opt-search-pop')).toBeInTheDocument();
    expect(container.querySelector('.dm-collapsible-clip .gy-opt-search-list')).toBeNull();
  });
});

describe('Data Mart field icon, checkboxes and descriptions', () => {
  const shownRow = (over: Partial<Row> = {}): Row => row({ id: 'class:orders.shown', block: 'metrics', group: 'Orders', groupId: 'orders', title: 'Orders Numbers on the Card', severity: 'notice', state: 'open', dismissable: true,
    options: [set('shown:a', 'Orders · items', true), { ...set('shown:none', 'No extra numbers'), declines: true }],
    multi: { max: 3, checked: [], action: () => undefined, items: [
      { path: 'a', label: 'Orders · items', martId: 'orders', recommended: true, description: 'Units sold' }, { path: 'b', label: 'Orders · tax', martId: 'orders', recommended: false },
      { path: 'c', label: 'Orders · tips', martId: 'orders', recommended: false }, { path: 'd', label: 'Orders · fees', martId: 'orders', recommended: false }] }, ...over });

  test('a set row shows the Data Mart icon before its value', () => {
    const r = row({ state: 'done', current: 'Orders · revenue', currentMartId: 'orders' });
    const { container } = render(<SetupTab {...props([r], { martIcons: { orders: 'orders' }, savedOpen: new Set() })} />);
    const value = container.querySelector('.gy-row-value')!;
    expect(value.previousElementSibling).toHaveClass('gy-value-icon');
    expect(value.previousElementSibling!.tagName.toLowerCase()).toBe('svg');
  });

  test('a row whose value is not a field shows no icon', () => {
    const { container } = render(<SetupTab {...props([row({ state: 'done', current: 'Daily amount' })], { savedOpen: new Set() })} />);
    expect(container.querySelector('.gy-value-icon')).toBeNull();
  });

  test('one checkbox per field, the recommended tagged, the saved ones checked; a fourth is disabled once 3 are checked', () => {
    const { rerender } = render(<SetupTab {...props([shownRow({ multi: { ...shownRow().multi!, checked: ['a'] } })])} />);
    const group = screen.getByRole('group', { name: 'Orders Numbers on the Card' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toBeChecked();
    expect(within(group).getByText('Recommended')).toBeInTheDocument();
    expect(boxes[3]).toBeEnabled();
    expect(screen.queryByText(/Up to 3/)).toBeNull();
    rerender(<SetupTab {...props([shownRow({ multi: { ...shownRow().multi!, checked: ['a', 'b', 'c'] } })])} />);
    const full = within(screen.getByRole('group', { name: 'Orders Numbers on the Card' })).getAllByRole('checkbox');
    expect(full[3]).toBeDisabled();
    expect(full[2]).toBeEnabled();
    expect(screen.getByText(/Up to 3/)).toBeInTheDocument();
  });

  test('checking a box stages the set in checkbox order; unchecking all stages the empty set; No extra numbers declines', () => {
    const p = props([shownRow({ multi: { ...shownRow().multi!, checked: ['c'] } })]);
    render(<SetupTab {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /tax/ }));
    expect(p.onPick).toHaveBeenLastCalledWith('class:orders.shown', `set:${JSON.stringify(['b', 'c'])}`);
    fireEvent.click(screen.getByRole('checkbox', { name: /tips/ }));
    expect(p.onPick).toHaveBeenLastCalledWith('class:orders.shown', 'set:[]');
    fireEvent.click(screen.getByRole('button', { name: 'No extra numbers' }));
    expect(p.onPick).toHaveBeenLastCalledWith('class:orders.shown', 'shown:none');
  });

  test('read-only shows the value only', () => {
    render(<SetupTab {...props([shownRow({ state: 'done', current: 'Orders · items' })], { readOnly: true, savedOpen: new Set() })} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Orders · items')).toBeInTheDocument();
  });

  test('a long list shows the top boxes and a search that adds a box', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ path: `f${i}`, label: `Orders · f${i}`, martId: 'orders', recommended: false }));
    const p = props([shownRow({ multi: { max: 3, checked: [], action: () => undefined, items } })]);
    render(<SetupTab {...p} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'f13' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /f13/ }));
    expect(p.onPick).toHaveBeenLastCalledWith('class:orders.shown', `set:${JSON.stringify(['f13'])}`);
  });

  test('a field with a description gets a (?) with a tooltip, glued to the last word of its label, and a click does not pick; one without gets none', () => {
    const p = props([shownRow(), row({ options: [{ ...set('a', 'Orders · revenue', true), description: 'Net of refunds' }, set('b', 'Orders · profit')] })]);
    render(<SetupTab {...p} />);
    const help = screen.getByRole('button', { name: 'About Orders · items' });
    fireEvent.click(help);
    expect(document.getElementById(help.getAttribute('aria-controls')!)).toHaveTextContent('Units sold');
    expect(help.closest('.gy-radio-tools, .gy-row-value')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'About Orders · tax' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About Orders · revenue' }));
    expect(p.onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'About Orders · profit' })).toBeNull();
  });

  test('a set row shows the description of its current field', () => {
    render(<SetupTab {...props([row({ state: 'done', current: 'Orders · revenue', currentMartId: 'orders', currentDescription: 'Net of refunds' })], { savedOpen: new Set() })} />);
    expect(screen.getByRole('button', { name: 'About Orders · revenue', hidden: true })).toBeInTheDocument();
  });
});

describe('0.5.4 fixes', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}`, label: `Orders · f${i}`, martId: 'orders', recommended: false, ...(i === 0 ? { link: '/ui/p/data-marts/orders', linkLabel: 'Orders · f0' } : {}), ...(i === 1 ? { description: 'Units sold' } : {}) }));
  const shown = (checked: string[], over: Partial<Row> = {}, n = 4): Row => row({ id: 'class:orders.shown', block: 'metrics', group: 'Orders', groupId: 'orders', title: 'Orders Numbers on the Card', severity: 'notice', state: 'open', dismissable: true,
    options: [{ ...set('shown:none', 'No extra numbers'), declines: true }], multi: { max: 3, checked, action: () => undefined, items: items(n) }, ...over });
  const openOther = row({ id: 'other', block: 'metrics', title: 'Other', options: [set('x', 'X')] });
  const tip = (container: HTMLElement) => container.querySelector('.gy-fieldtip-body') as HTMLElement;

  test('the field tooltip floats outside the collapsible clip, opens on click only, and Escape closes it', () => {
    const p = props([row({ options: [{ ...set('a', 'Orders · revenue', true), description: 'Net of refunds' }, set('b', 'Orders · profit')] })]);
    const { container } = render(<SetupTab {...p} />);
    const help = screen.getByRole('button', { name: 'About Orders · revenue' });
    expect(tip(container)).toBeNull();
    fireEvent.mouseEnter(help); fireEvent.focus(help);
    expect(tip(container)).toBeNull();
    fireEvent.click(help);
    const t = tip(container);
    expect(t).toHaveAttribute('role', 'tooltip');
    expect(t.closest('.dm-collapsible-clip')).toBeNull();
    expect(t.closest('.dm-page, .gy-setup, body')).not.toBeNull();
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(tip(container)).toBeNull();
  });

  test('search items show the (?) for a described option; hovering or clicking it picks nothing, clicking the item does', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...set(`o${i}`, `Orders · field ${i}`), ...(i === 5 ? { description: 'Five' } : {}) }));
    const p = props([row({ options: many })]);
    render(<SetupTab {...p} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'field 5' } });
    const opt = screen.getByRole('option', { name: /field 5/ });
    const help = within(opt).getByRole('button', { name: 'About Orders · field 5' });
    expect(help).toHaveAttribute('tabindex', '-1');
    fireEvent.mouseEnter(help); fireEvent.focus(help);
    fireEvent.mouseDown(help); fireEvent.click(help);
    expect(p.onPick).not.toHaveBeenCalled();
    fireEvent.mouseDown(opt);
    expect(p.onPick).toHaveBeenCalledWith('goal.metric', 'o5');
  });

  test('the edit pencil focuses the first checkbox of a checkbox row', async () => {
    render(<SetupTab {...props([shown(['f0'], { state: 'done', current: 'Orders · f0' }), openOther], { savedOpen: new Set(['other']) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Orders Numbers on the Card', hidden: true }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toHaveFocus());
  });

  test('checking back to the saved set stages no pick; an unset or dismissed row with nothing saved too', () => {
    const p = props([shown(['f0'], { state: 'done', current: 'Orders · f0' })], { savedOpen: new Set(['class:orders.shown']) });
    const { unmount } = render(<SetupTab {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /f0/ }));
    expect(p.onPick).toHaveBeenLastCalledWith('class:orders.shown', 'set:[]');
    unmount();
    const q = props([shown([], { dismissed: true })]);
    render(<SetupTab {...q} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /f2/ }));
    expect(q.onPick).toHaveBeenLastCalledWith('class:orders.shown', `set:${JSON.stringify(['f2'])}`);
  });

  test('unchecking a staged box back to the saved state removes the pick', () => {
    function S() {
      const [pk, setPk] = useState<Record<string, string>>({});
      const r = shown(['f0']);
      const live = pk[r.id] ? { ...r, multi: { ...r.multi!, checked: JSON.parse(pk[r.id]!.slice(4)) as string[] } } : r;
      return <SetupTab {...props([live], { picked: pk, optionRows: pk[r.id] ? { [r.id]: r } : {}, onPick: (id, o) => setPk((x) => { const n = { ...x }; if (o === null) delete n[id]; else n[id] = o; return n; }) })} />;
    }
    render(<S />);
    fireEvent.click(screen.getByRole('checkbox', { name: /f2/ }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /f2/ }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  test('Cancel shows in Edit or with a staged pick, removes the pick and closes Edit', () => {
    const p = props([shown(['f0'], { state: 'done', current: 'Orders · f0' }), openOther], { savedOpen: new Set(['other']) });
    render(<SetupTab {...p} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Orders Numbers on the Card', hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onPick).toHaveBeenLastCalledWith('class:orders.shown', null);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  test('11 checkboxes list all, 12 show the top boxes and a search', () => {
    const { unmount } = render(<SetupTab {...props([shown([], {}, 11)])} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(11);
    expect(screen.queryByRole('combobox')).toBeNull();
    unmount();
    render(<SetupTab {...props([shown([], {}, 12)])} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('a checkbox item with a link shows the Open in OWOX button, which opens without ticking', () => {
    const p = props([shown([])]);
    render(<SetupTab {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Orders · f0 in OWOX' }));
    expect(p.onOpen).toHaveBeenCalledWith('/ui/p/data-marts/orders');
    expect(screen.queryByRole('button', { name: 'Open Orders · f1 in OWOX' })).toBeNull();
  });

  test('the Up to 3 note shows only when 3 are checked', () => {
    const { rerender } = render(<SetupTab {...props([shown(['f0', 'f1'])])} />);
    expect(screen.queryByText(/Up to 3/)).toBeNull();
    rerender(<SetupTab {...props([shown(['f0', 'f1', 'f2'])])} />);
    expect(screen.getByText(/Up to 3/)).toBeInTheDocument();
  });
});

describe('the Contexts block', () => {
  const ctxRow = (id: string, title: string, over: Partial<Row> = {}) => row({ id, block: 'teams', group: 'Marketing', groupLink: '/ui/p/project-settings/contexts?context=m', groupDescription: 'Brings people **in**.', title, severity: 'warning', state: 'done', current: 'Orders · revenue', ...over });
  const rows = [ctxRow('team:m.metric', 'Marketing Critical Number'), ctxRow('team:m.plan', 'Marketing Plan', { current: null, state: 'open' }), row({ id: 'teams.exist', block: 'teams', title: 'Contexts That Move the Goal', severity: 'notice', state: 'done', current: 'Marketing, Sales', currentList: ['Marketing', 'Sales'] })];

  test('row titles in a context cell are plain and drop the context name; the cell is bordered', () => {
    const { container } = render(<SetupTab {...props(rows)} />);
    const cell = container.querySelector('details.gy-setup-cell')!;
    expect(cell).not.toBeNull();
    expect([...cell.querySelectorAll('.gy-row-title-plain')].map((e) => e.textContent)).toEqual(['Critical Number', 'Plan']);
    expect(cell.querySelector('.gy-row-title strong')).toBeNull();
    expect(screen.getByText('Contexts That Move the Goal').tagName).toBe('STRONG');
    expect(container.querySelector('.gy-setup-groups')).not.toBeNull();
  });

  test('the goal row lists each context with its icon', () => {
    const { container } = render(<SetupTab {...props(rows)} />);
    const items = container.querySelectorAll('.gy-ctx-item');
    expect([...items].map((e) => e.textContent)).toEqual(['Marketing', 'Sales']);
    items.forEach((e) => expect(e.querySelector('.gy-setup-group-icon svg')).not.toBeNull());
  });

  test('the label shows the description as Markdown and links to the context page', () => {
    const onOpen = vi.fn();
    render(<SetupTab {...props(rows, { onOpen })} />);
    const tip = screen.getByRole('button', { name: 'About Marketing' });
    fireEvent.click(tip);
    expect(screen.getByRole('dialog').querySelector('strong')?.textContent).toBe('in');
    fireEvent.click(screen.getByRole('button', { name: 'Open Marketing in OWOX' }));
    expect(onOpen).toHaveBeenCalledWith('/ui/p/project-settings/contexts?context=m');
  });

  test('no description: no (?), the link stays', () => {
    render(<SetupTab {...props(rows.map((r) => ({ ...r, groupDescription: undefined })))} />);
    expect(screen.queryByRole('button', { name: 'About Marketing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Marketing in OWOX' })).toBeInTheDocument();
  });
});

describe('0.5.5 layout', () => {
  test('an option without a Data Mart ("Not set", "Not needed", "No plan yet") has no icon slot, even where other options have an icon', () => {
    const iconed = { ...set('a', 'Orders · revenue', true), martId: 'orders' };
    render(<SetupTab {...props([row({ options: [iconed, set('b', 'No plan yet')], dismissable: true })])} />);
    const lab = (name: string) => (screen.getByRole('radio', { name }) as HTMLInputElement).labels![0]!;
    for (const n of ['Not set', 'Not needed', 'No plan yet']) expect(lab(n).querySelector('.gy-opt-gap, svg')).toBeNull();
    expect(lab('Orders · revenue Recommended').querySelector('svg')).not.toBeNull();
  });
});

describe('0.5.5 checkbox rows', () => {
  const ctxRow = (over: Partial<Row> = {}) => row({
    id: 'teams.exist', block: 'teams', title: 'Contexts That Move the Needle', severity: 'notice', state: 'open', current: 'Sales', currentList: ['Sales'],
    options: [{ id: 'teams', label: 'Create Ops and add their Data Marts', recommended: true, action: { kind: 'teams', teams: [] } }, { id: 'open', label: 'Create contexts in OWOX', recommended: false, action: { kind: 'open', path: '/x' } }],
    multi: { checked: ['c:1', 'c-2'], action: () => undefined, items: [
      { path: 'c:1', label: 'Sales', icon: 'context', recommended: false, description: 'Closes deals', link: '/ui/p/contexts?context=c%3A1' },
      { path: 'c-2', label: 'Marketing', icon: 'context', recommended: false },
      { path: 'c.3', label: 'Support', icon: 'context', recommended: false }] }, ...over });

  test('a context checkbox row has a context icon, a (?) and an OWOX link per context, no maximum, and the links under the boxes', () => {
    const p = props([ctxRow()]);
    render(<SetupTab {...p} />);
    const group = screen.getByRole('group', { name: 'Contexts That Move the Needle' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, false]);
    expect(group.querySelectorAll('svg.lucide-tags')).toHaveLength(3);
    expect(within(group).getByRole('button', { name: 'About Sales' })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Open Sales in OWOX' }));
    expect(p.onOpen).toHaveBeenCalledWith('/ui/p/contexts?context=c%3A1');
    expect(screen.queryByText(/Up to/)).toBeNull();
    fireEvent.click(boxes[2]!);
    expect(p.onPick).toHaveBeenLastCalledWith('teams.exist', `set:${JSON.stringify(['c:1', 'c-2', 'c.3'])}`);
    fireEvent.click(boxes[0]!);
    expect(p.onPick).toHaveBeenLastCalledWith('teams.exist', `set:${JSON.stringify(['c-2'])}`);
    fireEvent.click(screen.getByRole('button', { name: 'Create Ops and add their Data Marts' }));
    expect(p.onPick).toHaveBeenLastCalledWith('teams.exist', 'teams');
    fireEvent.click(screen.getByRole('button', { name: 'Create contexts in OWOX' }));
    expect(p.onOpen).toHaveBeenLastCalledWith('/x');
  });

  const coreRow = (checked: string[], n = 8) => row({
    id: 'core.classes', title: 'Core Classes', state: 'open', options: [],
    multi: { max: 7, checked, action: () => undefined, items: Array.from({ length: n }, (_, i) => ({ path: `m${i}`, label: `Mart ${i}`, martId: `m${i}`, icon: 'mart' as const, recommended: i < 3, description: i === 0 ? 'Buyers' : undefined, link: `/ui/p/data-marts/m${i}/data-setup` })) } });

  test('core classes: a checkbox per class with the Recommended pill, the Data Mart icon, its (?) and link; no radios; at most 7', () => {
    const six = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    const { rerender } = render(<SetupTab {...props([coreRow(['m0'])], { martIcons: { m0: 'orders' } })} />);
    const group = screen.getByRole('group', { name: 'Core Classes' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(8);
    expect(within(group).getAllByText('Recommended')).toHaveLength(3);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(group.querySelector('svg.lucide-receipt')).not.toBeNull();
    expect(within(group).getByRole('button', { name: 'About Mart 0' })).toBeInTheDocument();
    expect(within(group).getAllByRole('checkbox').every((b) => !(b as HTMLInputElement).disabled)).toBe(true);
    rerender(<SetupTab {...props([coreRow(six)], { martIcons: {} })} />);
    const boxes = within(screen.getByRole('group', { name: 'Core Classes' })).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[7]!.disabled).toBe(true);
    expect(boxes[6]!.disabled).toBe(false);
    expect(screen.getByText('Up to 7: uncheck one to pick another')).toBeInTheDocument();
  });

  test('a checkbox row with nothing to offer shows its link instead of boxes', () => {
    render(<SetupTab {...props([row({ id: 'core.classes', title: 'Core Classes', options: [{ id: 'none', label: 'Not available yet: add Data Marts', recommended: true, action: { kind: 'open', path: '/m' } }] })])} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not available yet: add Data Marts' })).toBeInTheDocument();
  });
});

describe('0.5.5 fix round', () => {
  const css = readFileSync(`${__dirname}/../styles.css`, 'utf8');
  const rules = css.split('}').map((r) => r.replace(/\/\*[\s\S]*?\*\//g, '').trim());
  const ctxRow = (checked: string[], over: Partial<Row> = {}) => row({
    id: 'teams.exist', block: 'teams', title: 'Contexts That Move the Needle', state: 'open', current: 'Sales', currentList: ['Sales'],
    options: [{ id: 'teams', label: 'Create Ops and add their Data Marts', recommended: true, action: { kind: 'teams', teams: [] } }],
    multi: { checked, action: () => undefined, items: [
      { path: 'a', label: 'Sales', icon: 'context', recommended: true, description: 'Closes deals', link: '/x' },
      { path: 'b', label: 'Marketing', icon: 'context', recommended: false },
      { path: 'c', label: 'Support', icon: 'context', recommended: false }] }, ...over });

  test('a Recommended pill never shares its line with a (?) or link that takes width: they hang in a zero-width box after the pill', () => {
    render(<SetupTab {...props([ctxRow(['a', 'b'])])} />);
    const label = screen.getByRole('checkbox', { name: /Sales/ }) as HTMLInputElement;
    const end = label.labels![0]!.querySelector('.gy-radio-end')!;
    // pill first, then the hanging tools; nothing between the label's last word and the pill
    expect([...end.children].map((c) => c.className)).toEqual(['gy-row-rec', 'gy-radio-tools']);
    expect(end.querySelector('.gy-radio-tools .gy-fieldtip')).not.toBeNull();
    expect(end.querySelector('.gy-radio-tools .gy-row-link')).not.toBeNull();
    expect(label.labels![0]!.querySelector('.gy-radio-tail .gy-fieldtip')).toBeNull();
    // a label with no pill keeps its (?) in the tail, still inside the zero-width box
    const plain = (screen.getByRole('checkbox', { name: /Marketing/ }) as HTMLInputElement).labels![0]!;
    expect(plain.querySelector('.gy-radio-tail .gy-radio-tools')).toBeNull();
    const rule = rules.find((r) => r.startsWith('.gy-radio-tools {'))!;
    expect(rule).toMatch(/width: 0;/);
    expect(rule).toMatch(/display: inline-block/);
    expect(rules.some((r) => /^\.gy-radio \.gy-row-link \{[^}]*-1rem/.test(r))).toBe(false);
  });

  test('(?) and link icons show by hover only: no focus-within reveal, no bare (hover: none) media', () => {
    const reveal = rules.filter((r) => /opacity: 1/.test(r) && /(fieldtip|row-link|ctx-tools)/.test(r));
    expect(reveal.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/:focus-within[^{]*(fieldtip|row-link-reveal|ctx-tools)|(fieldtip|row-link-reveal|ctx-tools)[^{]*:focus-within/);
    const media = css.split('\n').filter((l) => /^@media \((any-)?hover: none\)/.test(l) && /gy-(fieldtip|ctx-tools|row-link)/.test(l));
    expect(media.length).toBeGreaterThan(0);
    for (const l of media) expect(l).toMatch(/^@media \(hover: none\) and \(pointer: coarse\)/);
    // hidden, they ignore the pointer too
    expect(rules.find((r) => r.startsWith('.gy-fieldtip { opacity: 0'))).toMatch(/pointer-events: none/);
    expect(rules.find((r) => r.startsWith('.gy-ctx-tools { display'))).toMatch(/opacity: 0; pointer-events: none/);
    expect(css).toMatch(/\.gy-setup-cell > summary:has\(:focus-visible\) \.gy-ctx-tools/);
  });

  test('a cell label draws its (?) and link, and a click on the summary leaves them to the hover rules', () => {
    const rows = [row({ id: 'team:m.metric', block: 'teams', group: 'Marketing', groupDescription: 'Ads', groupLink: '/m', state: 'done', current: 'x' })];
    const { container } = render(<SetupTab {...props(rows, { savedOpen: new Set() })} />);
    const tools = container.querySelector('summary .gy-ctx-tools')!;
    expect(tools.querySelector('.gy-fieldtip')).not.toBeNull();
    expect(tools.querySelector('.gy-row-link')).not.toBeNull();
    // nothing in the markup shows them: no inline style, no data attribute
    expect(tools.getAttribute('style')).toBeNull();
    expect(container.querySelector('summary')!.getAttribute('data-show')).toBeNull();
  });

  test('a folded cell shrinks to its header: start-aligned when closed, stretched equal heights when open', () => {
    expect(css).toMatch(/\.gy-setup-groups > \.gy-setup-cell:not\(\[open\]\) \{ align-self: start; \}/);
    expect(rules.find((r) => r.startsWith('.gy-setup-groups {'))).toMatch(/align-items: stretch/);
    const rule = rules.find((r) => r.startsWith('.gy-setup-cell {'))!;
    expect(rule).toMatch(/padding: 0\.75rem/);
    expect(rule).toMatch(/border: 1px solid/);
    const rows = [row({ id: 'team:m.metric', block: 'teams', group: 'Marketing', state: 'done', current: 'x' }), row({ id: 'team:s.metric', block: 'teams', group: 'Sales', state: 'open' })];
    const { container } = render(<SetupTab {...props(rows, { savedOpen: new Set(['team:s.metric']) })} />);
    const cells = [...container.querySelectorAll('.gy-setup-groups > details.gy-setup-cell')] as HTMLDetailsElement[];
    expect(cells.map((c) => c.open)).toEqual([false, true]);
    expect(cells[0]!.querySelector(':scope > summary')).not.toBeNull();
  });

  test('a staged set of boxes and a staged "Create …" never replace each other', () => {
    const create = 'Create Ops and add their Data Marts';
    const { rerender } = render(<SetupTab {...props([ctxRow(['a', 'b'])], { picked: { 'teams.exist': `set:${JSON.stringify(['a'])}` } })} />);
    expect(screen.getByRole('button', { name: create })).toBeDisabled();
    rerender(<SetupTab {...props([ctxRow(['a', 'b'])], { picked: { 'teams.exist': 'teams' } })} />);
    for (const b of screen.getAllByRole('checkbox')) expect(b).toBeDisabled();
    expect(screen.getByText('Cancel to pick contexts by checkbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  test('checking back to the saved set drops the staged pick on a needle and a core row', () => {
    for (const make of [() => ctxRow(['a', 'b', 'c']), () => row({ id: 'core.classes', title: 'Core Classes', options: [], multi: { max: 7, checked: ['a', 'b', 'c'], action: () => undefined, items: ['a', 'b', 'c'].map((p) => ({ path: p, label: `Mart ${p}`, icon: 'mart' as const, recommended: false })) } })]) {
      const saved = make();
      const staged = { ...saved, multi: { ...saved.multi!, checked: ['a', 'b'] } };
      const p = props([staged], { picked: { [saved.id]: `set:${JSON.stringify(['a', 'b'])}` }, optionRows: { [saved.id]: saved } });
      const { unmount } = render(<SetupTab {...p} />);
      fireEvent.click(screen.getByRole('checkbox', { name: /(Support|Mart c)/ }));
      expect(p.onPick).toHaveBeenLastCalledWith(saved.id, null);
      unmount();
    }
  });

  test('a tooltip with a link is a non-modal dialog whose links Tab reaches; Tab past the last returns to the (?)', () => {
    const r = [row({ options: [{ ...set('a', 'Orders · revenue', true), description: 'See [one](https://a.com) and [two](https://b.com)' }, set('b', 'Orders · profit')] })];
    render(<SetupTab {...props(r)} />);
    const help = screen.getByRole('button', { name: 'About Orders · revenue' });
    fireEvent.click(help);
    const dialog = screen.getByRole('dialog', { name: 'Orders · revenue' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(screen.queryByRole('tooltip')).toBeNull();
    const [one, two] = screen.getAllByRole('link');
    one!.focus();
    fireEvent.keyDown(one!, { key: 'Tab' });
    expect(document.activeElement).toBe(one);
    two!.focus();
    fireEvent.keyDown(two!, { key: 'Tab' });
    expect(document.activeElement).toBe(help);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('focus moving away from an open tooltip closes it', () => {
    render(<SetupTab {...props([row({ options: [{ ...set('a', 'Orders · revenue', true), description: 'Net' }, set('b', 'Orders · profit')] })])} />);
    const help = screen.getByRole('button', { name: 'About Orders · revenue' });
    fireEvent.click(help);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(help, { relatedTarget: screen.getByRole('radio', { name: /profit/ }) });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
