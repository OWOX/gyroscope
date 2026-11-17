import type { Edge } from '../types';
import { primaryKeyPaths } from './graph';
import type { MartDetail } from '../owox/sources';

/** Exactly one primary key path. */
export const singleKey = (detail: MartDetail): boolean => primaryKeyPaths(detail.fields).length === 1;

/** Distinct Data Marts whose calculated fields reference each target. */
export function inboundCounts(edges: Edge[]): Map<string, number> {
  const from = new Map<string, Set<string>>();
  for (const e of edges) from.set(e.to, (from.get(e.to) ?? new Set()).add(e.from));
  return new Map([...from].map(([to, s]) => [to, s.size]));
}
