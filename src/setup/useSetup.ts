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
import { hashString } from '../lib/hash';
import type { Row } from './types';

export interface UseSetupArgs {
  owox: OwoxLike; store: CollectionsLike; generateWith: GenerateWith | null; isAdmin: boolean; by: string; projectId: string;
  now: () => Date; open: (path: string) => void; onModel: (d: Derived, graph: Graph) => void;
}

interface Loaded { settings: ProjectSettingsV5; graph: Graph; legacyCore: string[]; derived: Derived; hash: string }

/** A short fingerprint of a row's option ids: a stored pick is dropped when the options change. */
const fingerprint = (row: Row): string => hashString(row.options.map((o) => o.id).sort().join('|')).slice(0, 8);
const keyOf = (row: Row) => `${row.id}#${fingerprint(row)}`;

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
  // the stored picks for the current facts hash, keyed `${rowId}#${option fingerprint}`
  const [cached, setCached] = useState<Record<string, string>>({});
  const cachedNow = useRef<Record<string, string>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // a newer reload makes an older AI run stop merging and saving
  const runId = useRef(0);
  const inflight = useRef<Set<string>>(new Set());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  // choices run one after another: each reads the settings the one before it saved
  const chooseChain = useRef<Promise<unknown>>(Promise.resolve());

  const hold = (l: Loaded) => { loadedNow.current = l; setLoaded(l); };
  const baseRows = (l: Loaded) => buildRows({ settings: l.settings, graph: l.graph, model: l.derived.ok ? l.derived.model : null, legacyCore: l.legacyCore, projectId: latest.current.projectId, hasAi: !!latest.current.generateWith, ai: {}, aiPending: new Set() });

  /** Asks the AI for every AI row that is open and has no stored pick for its current options. Admins only; never awaited by a reload. */
  const runAi = useCallback(async (l: Loaded) => {
    const { generateWith, store, now, isAdmin } = latest.current;
    if (!isAdmin || !generateWith) return;
    const id = runId.current;
    const todo = baseRows(l).filter((r) => AI_ROWS.test(r.id) && r.state !== 'done' && cachedNow.current[keyOf(r)] === undefined && !inflight.current.has(keyOf(r)));
    if (todo.length === 0) return;
    for (const r of todo) inflight.current.add(keyOf(r));
    setPending((p) => new Set([...p, ...todo.map((r) => r.id)]));
    const facts = { projectDescription: l.graph.inputs.projectDescription };
    await runPool(todo.map((row) => async () => {
      const contextName = row.id.startsWith('team:') ? l.graph.inputs.contexts.find((c) => c.id === row.id.slice(5).split('.')[0])?.name : undefined;
      const key = keyOf(row);
      try {
        const pick = await aiPick(row, { ...facts, ...(contextName ? { contextName } : {}) }, generateWith);
        if (id !== runId.current) return;
        if (pick) {
          cachedNow.current = { ...cachedNow.current, [key]: pick };
          setCached(cachedNow.current);
          // writes go one after another: each save reads the doc and puts it back
          saveChain.current = saveChain.current.then(() => saveSuggestion(store, l.hash, key, pick, now())).catch(() => undefined);
        }
      } finally {
        // a reload replaced the set: the newer run owns these keys now
        if (id === runId.current) {
          inflight.current.delete(key);
          setPending((p) => { const n = new Set(p); n.delete(row.id); return n; });
        }
      }
    }), 4);
  }, []);

  const reload = useCallback(async () => {
    const { owox, store, onModel } = latest.current;
    const id = ++runId.current;
    inflight.current = new Set();
    setLoading(true);
    try {
      const [{ settings, legacyCore }, graph] = await Promise.all([loadSetup(store), loadGraph(owox)]);
      const sug = await loadSuggestions(store).catch(() => null);
      if (id !== runId.current) return;
      const hash = factsHash(graph);
      cachedNow.current = sug?.inputHash === hash ? sug.items : {};
      const derived = deriveModel(settings, graph);
      const l: Loaded = { settings, graph, legacyCore, derived, hash };
      setCached(cachedNow.current);
      setPending(new Set());
      hold(l);
      onModel(derived, graph);
      setLoading(false);
      void runAi(l);
    } catch (e) {
      if (id === runId.current) { setMessage(`Couldn't load setup: ${describeError(e)}`); setLoading(false); setPending(new Set()); }
      throw e;
    }
  }, [runAi]);

  const rows = useMemo(() => {
    if (!loaded) return [];
    const input = { settings: loaded.settings, graph: loaded.graph, model: loaded.derived.ok ? loaded.derived.model : null, legacyCore: loaded.legacyCore, projectId: args.projectId, hasAi: !!args.generateWith };
    // a stored pick counts only while it is one of the row's current options
    const ai: Record<string, string> = {};
    for (const r of buildRows({ ...input, ai: {}, aiPending: new Set() })) {
      const pick = cached[keyOf(r)];
      if (pick !== undefined && r.options.some((o) => o.id === pick)) ai[r.id] = pick;
    }
    return buildRows({ ...input, ai, aiPending: pending });
  }, [loaded, cached, pending, args.projectId, args.generateWith]);

  const chooseNow = useCallback(async (rowId: string, optionId: string, action?: (s: ProjectSettingsV5) => ProjectSettingsV5) => {
    const l = loadedNow.current;
    const { owox, store, by, now, open, onModel, isAdmin } = latest.current;
    if (!l || !isAdmin) return;
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
          const next = { ...l, settings: r.settings, derived };
          hold(next);
          onModel(derived, l.graph);
          // the change can bring new rows that want a pick
          void runAi(next);
        } else if (act.kind === 'append' || act.kind === 'teams') await reload().catch(() => undefined);
      } else if ('conflict' in r) {
        setMessage(`${r.conflict.by ?? 'Someone'} changed setup${r.conflict.at ? ` at ${clock(r.conflict.at)}` : ''}. Reloaded.`);
        await reload().catch(() => undefined);
      } else setMessage(r.snippet ? `${r.error}\n${r.snippet}` : r.error);
    } finally { setBusyRow(null); }
  }, [rows, reload, runAi]);

  const choose = useCallback((rowId: string, optionId: string, action?: (s: ProjectSettingsV5) => ProjectSettingsV5): Promise<void> => {
    const run = chooseChain.current.then(() => chooseNow(rowId, optionId, action));
    chooseChain.current = run.catch(() => undefined);
    return run;
  }, [chooseNow]);

  const props: SetupTabProps = {
    rows, loading, readOnly: !args.isAdmin, busyRow, message,
    onChoose: (rowId, optionId) => void choose(rowId, optionId),
    onDismiss: (rowId) => void choose(rowId, 'dismiss', (s) => dismiss(s, rowId)),
    onRetry: () => void reload().catch(() => undefined),
    onOpen: (path) => latest.current.open(path),
  };
  return { props, settings: loaded?.settings ?? null, reload };
}
