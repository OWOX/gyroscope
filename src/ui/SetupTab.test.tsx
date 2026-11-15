import { fireEvent, render, screen } from '@testing-library/react';
import { SetupTab } from './SetupTab';
import type { Row } from '../setup/types';

const row = (over: Partial<Row>): Row => ({ id: 'goal.metric', block: 'goal', title: 'Business Critical Number', question: 'What is the main business goal?', why: 'Every card is judged by how it moves this number.', severity: 'error', state: 'open', current: null, aiPending: false, dismissable: false,
  options: [{ id: 'a', label: 'Revenue (Orders)', recommended: true, action: { kind: 'open', path: '/' } }, { id: 'b', label: 'Profit (Orders)', recommended: false, action: { kind: 'open', path: '/' } }], ...over });
const props = (rows: Row[], over: object = {}) => ({ rows, loading: false, readOnly: false, busyRow: null, message: null, onChoose: vi.fn(), onDismiss: vi.fn(), onRetry: vi.fn(), ...over });

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
  render(<SetupTab {...props([row({ state: 'done', current: 'Profit (Orders)' })])} />);
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
});

test('Dismiss on a notice calls onDismiss', () => {
  const p = props([row({ id: 'goal.description', severity: 'notice', dismissable: true })]);
  render(<SetupTab {...p} />);
  fireEvent.click(screen.getByText('Dismiss'));
  expect(p.onDismiss).toHaveBeenCalledWith('goal.description');
});
