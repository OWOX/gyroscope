import { useCallback, useMemo, useRef, useState } from 'react';
import type { Graph } from '../model/graph-load';
import { deriveModel, type Derived } from '../model/derive';
import { loadGraph } from '../model/graph-load';
import { runPool } from '../lib/pool';
import { describeError } from '../lib/errors';
import type { CollectionsLike } from '../store/collections';
import { loadSetup, loadSuggestions, saveSuggestion } from '../store/settings';
import type { OwoxLike } from '../owox/sources';
import type { ProjectSettingsV5 } from '../types';
import type { SetupTabProps } from '../ui/SetupTab';
import { runAction } from './actions';
import { AI_ROWS, aiPick, factsHash, type GenerateWith } from './ai';
import { buildRows } from './rows';
import { dismiss } from './rows/common';

export interface UseSetupArgs {
  owox: OwoxLike; store: CollectionsLike; generateWith: GenerateWith | null; isAdmin: boolean; by: string; projectId: string;
  now: () => Date; open: (path: string) => void; onModel: (d: Derived, graph: Graph) => void;
}

interface Loaded { settings: ProjectSettingsV5; graph: Graph; legacyCore: string[]; derived: Derived; hash: string }

const clock = (at: string | null): string => {
  const t = at ? new Date(at) : null;
  return t && !Number.isNaN(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
};

/** Loads the settings and every schema, derives the canvas model, runs cached AI picks for admins and saves each choice. */
export function useSetup(args: UseSetupArgs): { props: SetupTabProps; settings: ProjectSettingsV5 | null; reload: () => Promise<void> } {
  const latest = useRef(args);
  latest.current = args;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loadedNow = useRef<Loaded | null>(null);
  const [ai, setAi] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // a newer reload makes an older AI run stop merging and saving
  const runId = useRef(0);

  const hold = (l: Loaded) => { loadedNow.current = l; setLoaded(l); };

  const runAi = useCallback(async (l: Loaded, rows: ReturnType<typeof buildRows>, id: number) => {
    const { generateWith, store, now } = latest.current;
    if (!generateWith) return;
    const todo = rows.filter((r) => AI_ROWS.test(r.id) && r.state !== 'done');
    setPending(new Set(todo.map((r) => r.id)));
    const facts = { projectDescription: l.graph.inputs.projectDescription };
    // writes go one after another: each save reads the doc and puts it back
    let chain: Promise<unknown> = Promise.resolve();
    await runPool(todo.map((row) => async () => {
      const contextName = row.id.startsWith('team:') ? l.graph.inputs.contexts.find((c) => c.id === row.id.slice(5).split('.')[0])?.name : undefined;
      const pick = await aiPick(row, { ...facts, ...(contextName ? { contextName } : {}) }, generateWith);
      if (id !== runId.current) return;
      if (pick) {
        setAi((p) => ({ ...p, [row.id]: pick }));
        chain = chain.then(() => saveSuggestion(store, l.hash, row.id, pick, now())).catch(() => undefined);
      }
      setPending((p) => { const n = new Set(p); n.delete(row.id); return n; });
    }), 4);
    await chain;
    if (id === runId.current) setPending(new Set());
  }, []);

  const reload = useCallback(async () => {
    const { owox, store, isAdmin, generateWith, projectId, onModel } = latest.current;
    const id = ++runId.current;
    setLoading(true);
    try {
      const [{ settings, legacyCore }, graph] = await Promise.all([loadSetup(store), loadGraph(owox)]);
      const sug = await loadSuggestions(store).catch(() => null);
      if (id !== runId.current) return;
      const hash = factsHash(graph);
      const fresh = sug?.inputHash === hash;
      const items = fresh ? sug!.items : {};
      const derived = deriveModel(settings, graph);
      const l: Loaded = { settings, graph, legacyCore, derived, hash };
      setAi(items);
      setPending(new Set());
      hold(l);
      onModel(derived, graph);
      setLoading(false);
      if (isAdmin && generateWith && !fresh) {
        const rows = buildRows({ settings, graph, model: derived.ok ? derived.model : null, legacyCore, projectId, hasAi: true, ai: items, aiPending: new Set() });
        await runAi(l, rows, id);
      }
    } catch (e) {
      if (id === runId.current) { setMessage(`Couldn't load setup: ${describeError(e)}`); setLoading(false); }
      throw e;
    }
  }, [runAi]);

  const rows = useMemo(() => loaded
    ? buildRows({ settings: loaded.settings, graph: loaded.graph, model: loaded.derived.ok ? loaded.derived.model : null, legacyCore: loaded.legacyCore, projectId: args.projectId, hasAi: !!args.generateWith, ai, aiPending: pending })
    : [], [loaded, ai, pending, args.projectId, args.generateWith]);

  const choose = useCallback(async (rowId: string, optionId: string, action?: (s: ProjectSettingsV5) => ProjectSettingsV5) => {
    const l = loadedNow.current;
    const { owox, store, by, now, open, onModel } = latest.current;
    if (!l) return;
    const option = rows.find((r) => r.id === rowId)?.options.find((o) => o.id === optionId);
    const act = action ? { kind: 'set' as const, next: action } : option?.action;
    if (!act) return;
    setBusyRow(rowId);
    setMessage(null);
    try {
      const r = await runAction(act, { owox, store, settings: l.settings, by, now, open });
      if (r.ok) {
        if (act.kind === 'set') {
          const derived = deriveModel(r.settings, l.graph);
          hold({ ...l, settings: r.settings, derived });
          onModel(derived, l.graph);
        } else if (act.kind === 'append' || act.kind === 'teams') await reload().catch(() => undefined);
      } else if ('conflict' in r) {
        setMessage(`${r.conflict.by ?? 'Someone'} changed setup${r.conflict.at ? ` at ${clock(r.conflict.at)}` : ''}. Reloaded.`);
        await reload().catch(() => undefined);
      } else setMessage(r.snippet ? `${r.error}\n${r.snippet}` : r.error);
    } finally { setBusyRow(null); }
  }, [rows, reload]);

  const props: SetupTabProps = {
    rows, loading, readOnly: !args.isAdmin, busyRow, message,
    onChoose: (rowId, optionId) => void choose(rowId, optionId),
    onDismiss: (rowId) => void choose(rowId, 'dismiss', (s) => dismiss(s, rowId)),
    onRetry: () => void reload().catch(() => undefined),
  };
  return { props, settings: loaded?.settings ?? null, reload };
}
