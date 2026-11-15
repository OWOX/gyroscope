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

/** Candidates ranked for core: single-column primary key, not the goal, directly connected to the goal, inbound > 0. */
export function rankCore(args: { goalId: string; nodes: { id: string; title: string; singleKey: boolean }[]; edges: Edge[] }): string[] {
  const { goalId, nodes, edges } = args;
  const inbound = inboundCounts(edges);
  const connected = (id: string) => edges.some((e) => (e.from === goalId && e.to === id) || (e.from === id && e.to === goalId));
  const cands = nodes.filter((n) => n.singleKey && n.id !== goalId && connected(n.id) && (inbound.get(n.id) ?? 0) > 0);
  const ids = new Set(cands.map((n) => n.id));
  const links = (id: string) => new Set(edges.flatMap((e) => (e.from === id && ids.has(e.to) ? [e.to] : e.to === id && ids.has(e.from) ? [e.from] : []))).size;
  return cands
    .sort((a, b) => (inbound.get(b.id) ?? 0) - (inbound.get(a.id) ?? 0) || links(b.id) - links(a.id) || a.title.localeCompare(b.title))
    .map((n) => n.id);
}
