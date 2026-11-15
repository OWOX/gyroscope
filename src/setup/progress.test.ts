import { progress } from './progress';
import type { Row } from './types';

const row = (severity: Row['severity'], state: Row['state']): Row => ({ id: `${severity}-${state}-${Math.random()}`, block: 'goal', title: '', question: '', why: '', severity, state, current: null, options: [], aiPending: false, dismissable: false });

test('counts open, broken and error rows by severity; done rows count as done', () => {
  expect(progress([row('error', 'open'), row('error', 'done'), row('warning', 'broken'), row('warning', 'error'), row('notice', 'open'), row('notice', 'done')]))
    .toEqual({ total: 6, done: 2, errors: 1, warnings: 2, notices: 1 });
});
