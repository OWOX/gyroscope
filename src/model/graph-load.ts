import { fetchBlendable, fetchInputs, fetchMartDetail, type Inputs, type OwoxLike } from '../owox/sources';
import { describeError } from '../lib/errors';
import { runPool } from '../lib/pool';
import type { MartNode } from './graph';

export interface Graph { inputs: Inputs; nodes: MartNode[]; failed: Map<string, string> }

/** Every listed Data Mart's schema and sources, 6 at a time; one that fails is in `failed`, never thrown. */
export async function loadGraph(owox: OwoxLike, onProgress?: (done: number, total: number) => void): Promise<Graph> {
  const inputs = await fetchInputs(owox);
  let done = 0;
  const total = inputs.marts.length;
  onProgress?.(0, total);
  const got = await runPool(inputs.marts.map((m) => async (): Promise<MartNode> => {
    try {
      const [detail, blendable] = await Promise.all([fetchMartDetail(owox, m.id), fetchBlendable(owox, m.id)]);
      return { id: m.id, title: m.title, contexts: m.contexts, detail, blendable };
    } finally { onProgress?.(++done, total); }
  }), 6);
  const failed = new Map<string, string>();
  got.forEach((r, i) => { if (r.status === 'rejected') failed.set(inputs.marts[i]!.id, describeError(r.reason)); });
  return { inputs, nodes: got.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])), failed };
}
