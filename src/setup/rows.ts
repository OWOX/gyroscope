import type { Row } from './types';
import { buildCtx, type RowsInput } from './rows/common';
import { goalRows } from './rows/goal';
import { coreRows } from './rows/core';
import { teamRows } from './rows/teams';
import { metricRows, ratioRows } from './rows/metrics';
import { checkRows, housekeepingRows } from './rows/checks';

export type { RowsInput } from './rows/common';

/** Every Setup row in block order, each with its state, options and one recommended option. */
export function buildRows(input: RowsInput): Row[] {
  const ctx = buildCtx(input);
  const rows = [...goalRows(ctx), ...coreRows(ctx), ...teamRows(ctx), ...metricRows(ctx), ...ratioRows(ctx), ...checkRows(ctx), ...housekeepingRows(ctx)];
  // a dismissed row is done unless the saved value it dismissed is itself gone or unreadable
  return rows.map((r) => (r.state === 'open' && r.severity !== 'error' && input.settings.dismissed.includes(r.id) ? { ...r, state: 'done', current: r.current ?? 'Not needed', ...(r.current === null ? { dismissed: true as const } : {}) } : r));
}
