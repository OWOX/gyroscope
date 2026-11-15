import type { Row } from './types';

export const isOpen = (r: Row) => r.state !== 'done';
/** Counts of rows left to do, by severity; done rows only count toward `done`. */
export function progress(rows: Row[]) {
  const open = rows.filter(isOpen);
  const n = (s: Row['severity']) => open.filter((r) => r.severity === s).length;
  return { total: rows.length, done: rows.length - open.length, errors: n('error'), warnings: n('warning'), notices: n('notice') };
}
