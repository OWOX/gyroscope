import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SetupTab } from './SetupTab';
import type { Row } from '../setup/types';

const row = (over: Partial<Row>): Row => ({ id: 'goal.metric', block: 'goal', title: 'Business Critical Number', question: 'What is the main business goal?', why: 'Every card is judged by how it moves this number.', severity: 'error', state: 'open', current: null, aiPicked: false, aiPending: false, dismissable: false,
  options: [{ id: 'a', label: 'Revenue (Orders)', recommended: true, action: { kind: 'open', path: '/' } }, { id: 'b', label: 'Profit (Orders)', recommended: false, action: { kind: 'open', path: '/' } }], ...over });
const props = (rows: Row[], over: object = {}) => ({ rows, loading: false, readOnly: false, busyRow: null, message: null, onChoose: vi.fn(), onDismiss: vi.fn(), onRetry: vi.fn(), onOpen: vi.fn(), ...over });

test('a not-set row shows its question, why, Not set and the recommendation to accept', () => {
  const p = props([row({})]);
  render(<SetupTab {...p} />);
  expect(screen.getByText('What is the main business goal?')).toBeInTheDocument();
  expect(screen.getByText('Every card is judged by how it moves this number.')).toBeInTheDocument();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Accept.*Revenue \(Orders\)/ }));
  expect(p.onChoose).toHaveBeenCalledWith('goal.metric', 'a');
});

test('a set row that differs shows current then the recommendation', () => {
  render(<SetupTab {...props([row({ state: 'done', current: 'Profit (Orders)', options: [{ id: 'a', label: 'Revenue (Orders)', recommended: true, action: { kind: 'set', next: (s) => s } }] })])} />);
  expect(screen.getByText('Profit (Orders)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Accept.*Revenue/, hidden: true })).toBeInTheDocument();
});

test('a set row equal to the recommendation shows no chip', () => {
  render(<SetupTab {...props([row({ state: 'done', current: 'Revenue (Orders)' })])} />);
  expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull();
});

test('a broken row shows its detail', () => {
  render(<SetupTab {...props([row({ state: 'broken', current: 'revenue_old (Orders)', detail: "revenue_old isn't in Orders any more" })])} />);
  expect(screen.getByText("revenue_old isn't in Orders any more")).toBeInTheDocument();
});

test('read-only shows values and recommendations without controls', () => {
  render(<SetupTab {...props([row({ dismissable: true, severity: 'notice' })], { readOnly: true })} />);
  expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByText('Dismiss')).toBeNull();
  expect(screen.getByText(/Revenue \(Orders\)/)).toBeInTheDocument();
});

test('the progress bar counts what is left by severity', () => {
  render(<SetupTab {...props([row({}), row({ id: 'x', severity: 'warning' }), row({ id: 'y', severity: 'notice', state: 'done' })])} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByText('1 blocker')).toBeInTheDocument();
  expect(screen.getByText('1 recommended')).toBeInTheDocument();
  expect(screen.getByText('left')).toBeInTheDocument();
});

test('Dismiss on a notice calls onDismiss', () => {
  const p = props([row({ id: 'goal.description', severity: 'notice', dismissable: true })]);
  render(<SetupTab {...p} />);
  fireEvent.click(screen.getByText('Dismiss'));
  expect(p.onDismiss).toHaveBeenCalledWith('goal.description');
});

test('a stray key on the closed options list does not choose anything', () => {
  const p = props([row({})]);
  render(<SetupTab {...p} />);
  const box = screen.getByRole('combobox');
  box.focus();
  fireEvent.keyDown(box, { key: 'p' });
  fireEvent.keyDown(box, { key: 'End' });
  expect(p.onChoose).not.toHaveBeenCalled();
});

test('busy disables the options list and Dismiss', () => {
  render(<SetupTab {...props([row({ dismissable: true, severity: 'notice' })], { busyRow: 'goal.metric' })} />);
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Dismiss Business Critical Number' })).toBeDisabled();
});

test('jumping opens a folded block and a closed group, then focuses the row', async () => {
  const done = row({ id: 'a', state: 'done', current: 'Revenue (Orders)' });
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

test('read-only still shows the spinner while the AI is pending', () => {
  const { container } = render(<SetupTab {...props([row({ aiPending: true })], { readOnly: true })} />);
  expect(container.querySelector('.gy-row-chip .gy-spin')).not.toBeNull();
});

describe('a finished row offers nothing to accept unless it is a settings change', () => {
  const opt = (action: object, label = 'Recommended thing') => [{ id: 'r', label, recommended: true, action: action as never }];
  const done = (options: Row['options'], current = 'Something else') => render(<SetupTab {...props([row({ state: 'done', current, options })])} />);
  const accept = () => screen.queryByRole('button', { name: /Accept/, hidden: true });
  test('a done description row (append)', () => { done(opt({ kind: 'append', scope: 'project', text: 'x' }, 'Add this line to the description'), 'Named in the description'); expect(accept()).toBeNull(); });
  test('a done teams row (teams)', () => { done(opt({ kind: 'teams', teams: [] }, 'Create Sales'), 'Sales, Marketing'); expect(accept()).toBeNull(); });
  test('a passed check (open)', () => { done(opt({ kind: 'open', path: '/' }, 'Ask an admin for access'), 'OK'); expect(accept()).toBeNull(); });
  test('a connected AI credential (open)', () => { done(opt({ kind: 'open', path: '/' }, 'Map an AI credential'), 'Connected'); expect(accept()).toBeNull(); });
  test('a saved ratio (keep)', () => { done(opt({ kind: 'set', next: (s: unknown) => s }, 'Keep this ratio').map((o) => ({ ...o, keep: true })), 'Revenue per order'); expect(accept()).toBeNull(); });
  test('a done set-row with a differing recommendation still shows Accept', () => { done(opt({ kind: 'set', next: (s: unknown) => s })); expect(accept()).not.toBeNull(); });
  test('an open description row still shows Accept', () => {
    render(<SetupTab {...props([row({ state: 'open', options: opt({ kind: 'append', scope: 'project', text: 'x' }, 'Add this line to the description') })])} />);
    expect(accept()).not.toBeNull();
  });
});

describe('progress fill', () => {
  const fill = (rows: Row[]) => { const { container } = render(<SetupTab {...props(rows)} />); return container.querySelector('.gy-progress-fill') as HTMLElement; };
  const done = (id: string, severity: Row['severity']) => row({ id, severity, state: 'done', current: 'Revenue (Orders)' });
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

test('the recommendation chip carries the full label as a title', () => {
  render(<SetupTab {...props([row({})])} />);
  expect(screen.getByRole('button', { name: /Accept.*Revenue/ })).toHaveAttribute('title', 'Revenue (Orders)');
});

describe('the link to OWOX and the AI icon', () => {
  const linked = (link?: string) => [{ id: 'a', label: 'Revenue (Orders)', recommended: true, action: { kind: 'open', path: '/' } as never, ...(link ? { link } : {}) }];
  test('the button opens the path, also for a read-only viewer', () => {
    const p = props([row({ options: linked('/ui/p1/data-marts/orders/data-setup?field=revenue') })], { readOnly: true });
    render(<SetupTab {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Revenue (Orders) in OWOX' }));
    expect(p.onOpen).toHaveBeenCalledWith('/ui/p1/data-marts/orders/data-setup?field=revenue');
  });
  test('an option without a link shows no button', () => {
    render(<SetupTab {...props([row({ options: linked() })])} />);
    expect(screen.queryByRole('button', { name: /in OWOX/ })).toBeNull();
  });
  test('the sparkles icon shows only on an AI pick', () => {
    const { container, rerender } = render(<SetupTab {...props([row({})])} />);
    expect(container.querySelector('.lucide-sparkles')).toBeNull();
    rerender(<SetupTab {...props([row({ aiPicked: true })])} />);
    expect(container.querySelector('.gy-row-chip .lucide-sparkles')).not.toBeNull();
    rerender(<SetupTab {...props([row({ aiPicked: true })], { readOnly: true })} />);
    expect(container.querySelector('.gy-row-chip .lucide-sparkles')).not.toBeNull();
  });
});
