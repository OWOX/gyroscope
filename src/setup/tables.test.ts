import { expect, test } from 'vitest';
import { findMetricRows } from './tables';

const M = '1a1b1c1d-2a2b-4c2d-8e3e-3f3f3f3f3f3f';
const l = (text: string, field: string) => `[${text}](https://app.owox.com/ui/p1/data-marts/${M}/data-setup?field=${field})`;
const rows = (planCell: string) => findMetricRows(`| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | X | ${planCell} | ${l('Orders · x', 'x')} |`, 'project');

test('a plan with a "date field:" link reads the plan and its date apart', () => {
  const r = rows(`${l('Plan · p', 'p')}, date field: ${l('Plan · d', 'd')}`)[0]!;
  expect(r.plan.map((x) => x.field)).toEqual(['p']);
  expect(r.planDate?.field).toBe('d');
});

test('"Date Field" inside a link label is not the marker', () => {
  const r = rows(`${l('Plan · Date Field: p', 'p')}`)[0]!;
  expect(r.plan.map((x) => x.field)).toEqual(['p']);
  expect(r.planDate).toBeNull();
});

test('a date-first cell still finds the plan', () => {
  const r = rows(`date field: ${l('Plan · d', 'd')}, ${l('Plan · p', 'p')}`)[0]!;
  expect(r.planDate?.field).toBe('d');
  expect(r.plan.map((x) => x.field)).toEqual(['p']);
});
