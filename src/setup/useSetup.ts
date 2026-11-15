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
import type { Action, Row } from './types';

export interface UseSetupArgs {
  owox: OwoxLike; store: CollectionsLike; generateWith: GenerateWith | null; isAdmin: boolean; by: string; projectId: string;
  now: () => Date; open?: (path: string) => void; onModel: (d: Derived, graph: Graph) => void;
}

/** A staged choice: the option picked on a row and what it will do on Save. */
interface Pick { rowId: string; optionId: string; action: Action }

interface Loaded { settings: ProjectSettingsV5; graph: Graph; legacyCore: string[]; derived: Derived; hash: string }

/** A short fingerprint of a row's option ids: a stored pick is dropped when the options change. */
const fingerprint = (row: Row): string => hashString(row.options.map((o) => o.id).sort().join('|')).slice(0, 8);
const keyOf = (row: Row) => `${row.id}#${fingerprint(row)}`;

const clock = (at: string | null): string => {
  const t = at ? new Date(at) : null;
  return t && !Number.isNaN(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
};

const applyPicks = (settings: ProjectSettingsV5, picks: Pick[]): ProjectSettingsV5 => picks.reduce((s, p) => (p.action.kind === 'set' ? p.action.next(s) : s), settings);

/** Loads the settings and every schema, derives the canvas model, runs cached AI picks for admins and stages choices in a draft that one Save writes. */
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
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  // staged choices in pick order; Save writes them together
  const [picks, setPicksState] = useState<Pick[]>([]);
  const picksNow = useRef<Pick[]>([]);
  const setPicks = (p: Pick[]) => { picksNow.current = p; setPicksState(p); };
  // a newer reload makes an older AI run stop merging and saving
  const runId = useRef(0);
  const inflight = useRef<Set<string>>(new Set());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const hold = (l: Loaded) => { loadedNow.current = l; setLoaded(l); };
  const rowsFor = (l: Loaded, settings: ProjectSettingsV5, derived: Derived, ai: Record<string, string>, aiPending: ReadonlySet<string>) =>
    buildRows({ settings, graph: l.graph, model: derived.ok ? derived.model : null, legacyCore: l.legacyCore, projectId: latest.current.projectId, hasAi: !!latest.current.generateWith, ai, aiPending });

  /** Asks the AI for every AI row that is open in the draft and has no stored pick for its current options. Admins only; never awaited by a reload. */
  const runAi = useCallback(async (l: Loaded, settings: ProjectSettingsV5 = l.settings) => {
    const { generateWith, store, now, isAdmin } = latest.current;
    if (!isAdmin || !generateWith) return;
    const id = runId.current;
    const derived = settings === l.settings ? l.derived : deriveModel(settings, l.graph);
    const todo = rowsFor(l, settings, derived, {}, new Set()).filter((r) => AI_ROWS.test(r.id) && r.state !== 'done' && cachedNow.current[keyOf(r)] === undefined && !inflight.current.has(keyOf(r)));
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
      void runAi(l, applyPicks(settings, picksNow.current));
    } catch (e) {
      if (id === runId.current) { setMessage(`Couldn't load setup: ${describeError(e)}`); setLoading(false); setPending(new Set()); }
      throw e;
    }
  }, [runAi]);

  // the draft: the saved settings with every staged `set` applied in pick order; the rows and the model follow it
  const draft = useMemo(() => {
    if (!loaded) return null;
    if (picks.length === 0) return { settings: loaded.settings, derived: loaded.derived };
    const settings = applyPicks(loaded.settings, picks);
    return { settings, derived: deriveModel(settings, loaded.graph) };
  }, [loaded, picks]);

  const { rows, savedOpen, savedCurrent } = useMemo(() => {
    if (!loaded || !draft) return { rows: [] as Row[], savedOpen: new Set<string>(), savedCurrent: {} as Record<string, string | null> };
    // a stored pick counts only while it is one of the row's current options
    const ai: Record<string, string> = {};
    for (const r of rowsFor(loaded, draft.settings, draft.derived, {}, new Set())) {
      const pick = cached[keyOf(r)];
      if (pick !== undefined && r.options.some((o) => o.id === pick)) ai[r.id] = pick;
    }
    const rows = rowsFor(loaded, draft.settings, draft.derived, ai, pending);
    const saved = new Map((picks.length ? rowsFor(loaded, loaded.settings, loaded.derived, {}, new Set()) : rows).map((r) => [r.id, r]));
    return {
      rows,
      // rows the saved settings leave unanswered, a row that only exists in the draft included
      savedOpen: new Set(rows.filter((r) => saved.get(r.id)?.state !== 'done').map((r) => r.id)),
      savedCurrent: Object.fromEntries([...saved].map(([id, r]) => [id, r.current])),
    };
  }, [loaded, draft, picks, cached, pending, args.projectId, args.generateWith]);
  const rowsNow = useRef(rows);
  rowsNow.current = rows;

  const onPick = useCallback((rowId: string, optionId: string | null) => {
    const l = loadedNow.current;
    if (!l || !latest.current.isAdmin || savingNow.current) return;
    let next = picksNow.current.filter((p) => p.rowId !== rowId);
    if (optionId !== null) {
      const row = rowsNow.current.find((r) => r.id === rowId);
      const action: Action | undefined = optionId === 'dismiss' && row?.dismissable ? { kind: 'set', next: (s) => dismiss(s, rowId) } : row?.options.find((o) => o.id === optionId)?.action;
      if (!action || action.kind === 'open') return;
      next = [...next, { rowId, optionId, action }];
    }
    setPicks(next);
    // the draft can bring new rows that want an AI pick
    void runAi(l, applyPicks(l.settings, next));
  }, [runAi]);

  const onSave = useCallback(async () => {
    const l = loadedNow.current;
    const { owox, store, by, now, open, isAdmin } = latest.current;
    const staged = picksNow.current;
    if (!l || !isAdmin || staged.length === 0 || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setMessage(null);
    const written = new Set<Pick>();
    const deps = { owox, store, by, now, open: open ?? (() => {}) };
    let ok = true;
    try {
      let settings = l.settings;
      const sets = staged.filter((p) => p.action.kind === 'set');
      if (sets.length) {
        const next = applyPicks(l.settings, staged);
        const r = await runAction({ kind: 'set', next: () => next }, { ...deps, settings });
        if (!r.ok) {
          ok = false;
          if ('conflict' in r) setMessage(`${r.conflict.by ?? 'Someone'} changed setup${r.conflict.at ? ` at ${clock(r.conflict.at)}` : ''}. Reloaded.`);
          else setMessage(r.snippet ? `${r.error}\n${r.snippet}` : r.error);
          return;
        }
        settings = r.settings;
        for (const p of sets) written.add(p);
        hold({ ...l, settings, derived: deriveModel(settings, l.graph) });
      }
      for (const p of staged.filter((x) => x.action.kind !== 'set')) {
        const r = await runAction(p.action, { ...deps, settings });
        if (!r.ok) { ok = false; setMessage('conflict' in r ? 'Setup changed while saving. Reloaded.' : r.snippet ? `${r.error}\n${r.snippet}` : r.error); return; }
        written.add(p);
      }
      await reload().catch(() => undefined);
    } finally {
      // what reached OWOX is not replayed: a retry would write an appended line twice
      setPicks(picksNow.current.filter((p) => !written.has(p)));
      if (!ok) await reload().catch(() => undefined);
      savingNow.current = false;
      setSaving(false);
    }
  }, [reload]);

  const props: SetupTabProps = {
    rows, loading, readOnly: !args.isAdmin, message, picked: Object.fromEntries(picks.map((p) => [p.rowId, p.optionId])),
    onPick, dirty: picks.length, saving, onSave: () => void onSave(), onDiscard: () => { if (!savingNow.current) setPicks([]); },
    savedOpen, savedCurrent,
    onRetry: () => void reload().catch(() => undefined),
    onOpen: args.open && ((path) => latest.current.open?.(path)),
  };
  return { props, settings: loaded?.settings ?? null, reload };
}
