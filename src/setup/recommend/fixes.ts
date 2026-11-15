import type { MartNode } from '../../model/graph';
import { flattenFields } from '../../owox/sources';
import { cands, type FieldCand } from './fields';

const singular = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/ies$/, 'y').replace(/s$/, '');

/** An `id` or `*_id` field: the one named after the Data Mart first, required before nullable. */
export function pickPrimaryKey(node: MartNode): string | null {
  const flat = flattenFields(node.detail.fields).filter(({ field }) => /(^|_)id$/i.test(field.name) || /[a-z]Id$/.test(field.name));
  const own = `${singular(node.title).replace(/_/g, '')}id`;
  const score = ({ field }: (typeof flat)[number]) => {
    const nullable = field.mode === 'NULLABLE';
    const flatName = field.name.toLowerCase().replace(/_/g, '');
    const named = flatName === own || (flatName === 'id' && !nullable);
    return (named ? 0 : 2) + (nullable ? 1 : 0);
  };
  return flat.map((x, i) => ({ x, i })).sort((a, b) => score(a.x) - score(b.x) || a.i - b.i)[0]?.x.path ?? null;
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length]!;
}

/** The field closest to a gone path: most shared name tokens, then a name starting with it, then fewest edits. */
export function repick(path: string, node: MartNode, keep: (f: FieldCand) => boolean): FieldCand | null {
  const want = tokens(path);
  const shared = (c: FieldCand) => [...tokens(c.path)].filter((t) => want.has(t)).length;
  const prefix = (c: FieldCand) => (c.path.toLowerCase().startsWith(path.toLowerCase()) ? 0 : 1);
  return cands(node, () => true).filter(keep).sort((a, b) => shared(b) - shared(a) || prefix(a) - prefix(b) || distance(path, a.path) - distance(path, b.path))[0] ?? null;
}
