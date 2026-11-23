import { cachedOwox } from '../src/cache/martCache';
import { resolveRange } from '../src/lib/dates';
import { deriveModel } from '../src/model/derive';
import { loadGraph } from '../src/model/graph-load';
import { shownModel } from '../src/model/shown';
import { cacheKey, refreshCanvas } from '../src/metrics/refresh';
import type { OwoxLike } from '../src/owox/sources';
import { parseWarmInput } from '../src/schedules/input';
import type { CollectionsLike } from '../src/store/collections';
import { loadSetup } from '../src/store/settings';

/** OWOX shows `code` as the run's error code; it must match ^[A-Z][A-Z0-9_]{0,63}$. */
export class ActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

interface WarmContext { owox: OwoxLike; collections: CollectionsLike['collections']; execution: { deadlineAt: string } }
interface WarmResult { ranges: number; marts: number; queries: number; skipped: number; failed: string[]; tooLarge: string[]; written: string[] }

// a range is a full canvas refresh; one that starts this close to the deadline would be cut off mid-way
const RESERVE_MS = 30_000;

export async function warmCache(raw: unknown, ctx: WarmContext, now: () => Date = () => new Date()): Promise<WarmResult> {
  const input = parseWarmInput(raw);
  if (!input) throw new ActionError('INVALID_RANGES', 'The schedule parameters are not valid; save the schedule again.');
  const store: CollectionsLike = { collections: ctx.collections };
  const { owox } = ctx;
  // Derive the canvas model with the schedule owner's current Data Mart access.
  const [{ settings }, graph] = await Promise.all([loadSetup(store), loadGraph(owox)]);
  const derived = deriveModel(settings, graph);
  if (!derived.ok) throw new ActionError('MODEL_MISSING', `Finish Setup in Gyroscope before running a schedule. ${derived.blocked.detail}`);
  const { model } = derived;
  const visibleIds = new Set(graph.inputs.marts.map((mart) => mart.id));
  const details = new Map(graph.nodes.map((node) => [node.id, node.detail]));
  // an unparseable deadline must not switch the reserve off; assume the 5 minute action limit
  const parsed = Date.parse(ctx.execution.deadlineAt);
  const deadline = Number.isFinite(parsed) ? parsed : now().getTime() + 300_000;
  const out: WarmResult = { ranges: 0, marts: 0, queries: 0, skipped: 0, failed: [], tooLarge: [], written: [] };
  for (const r of input.ranges) {
    if (deadline - now().getTime() < RESERVE_MS) { out.skipped++; continue; }
    const spec = resolveRange(r.range, r.compare, now(), r.weekStart);
    const key = cacheKey(r.range, r.compare, r.weekStart);
    // write-only: a scheduled run exists to replace what is cached
    const src = cachedOwox({ owox, store, key, anchor: spec.anchor, mode: 'write-only', now });
    await refreshCanvas({ owox: src.owox, model, spec, key, thresholdPct: settings.thresholdPct, visibleIds, details });
    const f = await src.flush();
    out.ranges++;
    out.queries += src.stats().misses;
    out.failed.push(...f.failed);
    out.tooLarge.push(...f.tooLarge);
    out.written.push(...f.written);
  }
  // refreshCanvas swallows per-metric errors, so a run can finish "fine" with nothing cached
  if (out.ranges > 0 && out.written.length === 0 && (out.failed.length > 0 || out.tooLarge.length > 0)) {
    throw new ActionError('CACHE_NOT_WRITTEN', `Nothing was saved to the cache: ${out.failed.length} write(s) failed and ${out.tooLarge.length} were too large. Run the schedule again; if it keeps failing, reduce the number of metrics.`);
  }
  // only metrics a class lists (and the member shows) are queried
  const known = new Set(model.metrics.map((m) => m.id));
  if (out.ranges > 0 && out.queries === 0 && shownModel(model, details).classes.some((c) => c.metricIds.some((id) => known.has(id)))) {
    throw new ActionError('NO_DATA', 'No Data Mart returned any data. The member who created the schedule may not be able to read these Data Marts; check their access and run the schedule again.');
  }
  out.marts = new Set(out.written.map((id) => id.slice(0, id.indexOf(':')))).size;
  return out;
}
