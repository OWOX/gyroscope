import { fireEvent, render, screen } from '@testing-library/react';
import { Blocked } from './Blocked';

const base = { projectId: 'p42', onRetry: () => {}, onOpenSetup: () => {} };

test('shows the reason and the steps, and Open Setup is the primary button', () => {
  const onOpenSetup = vi.fn();
  render(<Blocked {...base} blocked={{ code: 'NO_GOAL', detail: 'The Business Critical Number is not set.', mismatches: [] }} onOpenSetup={onOpenSetup} />);
  expect(screen.getByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  expect(screen.getByText('The Business Critical Number is not set.')).toBeInTheDocument();
  expect(screen.getByText(/answer "What is the main business goal\?"/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }));
  expect(onOpenSetup).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('lists mismatches', () => {
  render(<Blocked {...base} blocked={{ code: 'GOAL_NO_DATE', detail: 'x', mismatches: ['date not found'] }} />);
  expect(screen.getByText('date not found')).toBeInTheDocument();
});

test('a missing goal field and a missing primary key point at Setup', () => {
  const { rerender } = render(<Blocked {...base} blocked={{ code: 'GOAL_FIELD_NOT_FOUND', detail: 'x', mismatches: [] }} />);
  expect(screen.getByText(/Open Setup and answer "What is the main business goal\?" again/)).toBeInTheDocument();
  expect(screen.queryByText(/project description/)).toBeNull();
  rerender(<Blocked {...base} blocked={{ code: 'GOAL_NO_PRIMARY_KEY', detail: 'x', mismatches: [] }} />);
  expect(screen.getByText(/Goal Data Mart Primary Key/)).toBeInTheDocument();
});

test('a member is told to ask an admin and can still open Setup', () => {
  render(<Blocked {...base} isAdmin={false} blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} />);
  expect(screen.getByText('Ask a project admin to finish Setup.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Setup' })).toBeInTheDocument();
});

test('Back shows only when given', () => {
  const { rerender } = render(<Blocked {...base} blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} />);
  expect(screen.queryByRole('button', { name: 'Back to canvas' })).toBeNull();
  const onBack = vi.fn();
  rerender(<Blocked {...base} blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} onBack={onBack} />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to canvas' }));
  expect(onBack).toHaveBeenCalled();
});

test('a failed goal read says it was a read failure and to Retry, for a member too', () => {
  render(<Blocked {...base} isAdmin={false} blocked={{ code: 'GOAL_NO_ACCESS', detail: 'x', mismatches: [] }} />);
  expect(screen.getByText(/couldn't be read/)).toBeInTheDocument();
  expect(screen.getByText(/Click Retry/)).toBeInTheDocument();
  expect(screen.queryByText(/ask for access/i)).toBeNull();
});

test.each([true, false])('NO_ACCESSIBLE_GOAL shows the access copy and Open Setup (admin: %s)', (isAdmin) => {
  const detail = "To use Gyroscope, you need access to a Data Mart with a critical number: the project's or a context's. Ask a project admin for access.";
  render(<Blocked {...base} isAdmin={isAdmin} blocked={{ code: 'NO_ACCESSIBLE_GOAL', detail, mismatches: [] }} />);
  expect(screen.getByText(detail)).toBeInTheDocument();
  expect(screen.queryByText('How to fix')).toBeNull();
  expect(screen.getByRole('button', { name: 'Open Setup' })).toBeInTheDocument();
});
