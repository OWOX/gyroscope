import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** A staged choice: the option picked on a row. What it does is looked up in the draft rows each time. */
interface Pick { rowId: string; optionId: string }

interface Valid { pick: Pick; kind: Action['kind']; row: Row }

interface Loaded { settings: ProjectSettingsV5; graph: Graph; legacyCore: string[]; derived: Derived; hash: string }

/** A short fingerprint of a row's option ids: a stored pick is dropped when the options change. */
const fingerprint = (row: Row): string => hashString(row.options.map((o) => o.id).sort().join('|')).slice(0, 8);
const keyOf = (row: Row) => `${row.id}#${fingerprint(row)}`;

const clock = (at: string | null): string => {
  const t = at ? new Date(at) : null;
  return t && !Number.isNaN(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
};

const actionOf = (row: Row | undefined, optionId: string): Action | undefined =>
  optionId === 'dismiss' ? (row?.dismissable ? { kind: 'set', next: (s) => dismiss(s, row.id) } : undefined) : row?.options.find((o) => o.id === optionId)?.action;

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
      void runAi(l, replay(l, picksNow.current).settings);
    } catch (e) {
      if (id === runId.current) { setMessage(`Couldn't load setup: ${describeError(e)}`); setLoading(false); setPending(new Set()); }
      throw e;
    }
  }, [runAi]);

  /** Replays the picks over the saved settings: each runs against the rows the earlier ones produced, and a stale one (its row or option is gone) is skipped. */
  const replay = (l: Loaded, staged: Pick[]) => {
    let settings = l.settings;
    let derived = l.derived;
    const valid: Valid[] = [];
    for (const pick of staged) {
      // the row as it stood when this pick ran: its options are what the pick chose from
      const row = rowsFor(l, settings, derived, {}, new Set()).find((r) => r.id === pick.rowId);
      const action = actionOf(row, pick.optionId);
      if (!action || action.kind === 'open') continue;
      valid.push({ pick, kind: action.kind, row: row! });
      if (action.kind === 'set') { settings = action.next(settings); derived = deriveModel(settings, l.graph); }
    }
    return { settings, derived, valid };
  };

  // the draft: the saved settings with every staged `set` applied in pick order; the rows and the model follow it
  const draft = useMemo(() => {
    if (!loaded) return null;
    if (picks.length === 0) return { settings: loaded.settings, derived: loaded.derived, valid: [] as Valid[] };
    return replay(loaded, picks);
  }, [loaded, picks]);

  const { rows, savedOpen, optionRows } = useMemo(() => {
    if (!loaded || !draft) return { rows: [] as Row[], savedOpen: new Set<string>(), optionRows: {} as Record<string, Row> };
    const build = (settings: ProjectSettingsV5, derived: Derived) => {
      // a stored pick counts only while it is one of the row's current options
      const ai: Record<string, string> = {};
      for (const r of rowsFor(loaded, settings, derived, {}, new Set())) {
        const pick = cached[keyOf(r)];
        if (pick !== undefined && r.options.some((o) => o.id === pick)) ai[r.id] = pick;
      }
      return rowsFor(loaded, settings, derived, ai, pending);
    };
    const live = build(draft.settings, draft.derived);
    const saved = picks.length ? build(loaded.settings, loaded.derived) : live;
    // a picked row the draft no longer builds (a skipped ratio pair) stays, as done, until Save
    const rows = [...live];
    const have = new Set(rows.map((r) => r.id));
    const ranOn = new Map(draft.valid.map((v) => [v.pick.rowId, v.row]));
    // the AI's cached pick marks the recommendation on a row as it stood, as it does on a live one
    const withAi = (r: Row): Row => {
      const pick = cached[keyOf(r)];
      return pick !== undefined && r.options.some((o) => o.id === pick) ? { ...r, aiPicked: true, options: r.options.map((o) => ({ ...o, recommended: o.id === pick })) } : r;
    };
    saved.forEach((r, i) => {
      const was = ranOn.get(r.id);
      if (have.has(r.id) || !was) return;
      const prev = saved.slice(0, i).reverse().find((x) => have.has(x.id));
      rows.splice(prev ? rows.findIndex((x) => x.id === prev.id) + 1 : 0, 0, { ...withAi(was), state: 'done' });
      have.add(r.id);
    });
    const byId = new Map(saved.map((r) => [r.id, r]));
    return {
      rows,
      // rows the saved settings leave unanswered, a row that only exists in the draft included
      savedOpen: new Set(rows.filter((r) => byId.get(r.id)?.state !== 'done').map((r) => r.id)),
      // a picked row offers the options its pick chose from, so its radios hold still while later picks change the draft
      optionRows: Object.fromEntries([...ranOn].map(([id, r]) => [id, { ...withAi(r), aiPending: live.find((x) => x.id === id)?.aiPending ?? false }])),
    };
  }, [loaded, draft, picks, cached, pending, args.projectId, args.generateWith]);
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  const optionsNow = useRef(optionRows);
  optionsNow.current = optionRows;
  // a stale pick is dropped for good, so it can't come back when its row does
  useEffect(() => {
    if (draft && !saving && draft.valid.length !== picks.length) setPicks(picks.filter((p) => draft.valid.some((v) => v.pick === p)));
  }, [draft, picks, saving]);

  const onPick = useCallback((rowId: string, optionId: string | null) => {
    const l = loadedNow.current;
    if (!l || !latest.current.isAdmin || savingNow.current) return;
    const cur = picksNow.current;
    let next = cur.filter((p) => p.rowId !== rowId);
    if (optionId !== null) {
      // the same row the radios were drawn from: where an earlier pick of this row ran, else the draft
      const row = optionsNow.current[rowId] ?? rowsNow.current.find((r) => r.id === rowId);
      const opt = row?.options.find((o) => o.id === optionId);
      const action = actionOf(row, optionId);
      if (!action || action.kind === 'open') return;
      // "Keep" is the row's default, not a change
      if (!opt?.keep) {
        const i = cur.findIndex((p) => p.rowId === rowId);
        // a re-pick keeps the row's place in the order
        next = i >= 0 ? cur.map((p, j) => (j === i ? { rowId, optionId } : p)) : [...cur, { rowId, optionId }];
      }
    }
    setPicks(next);
    // the draft can bring new rows that want an AI pick
    void runAi(l, replay(l, next).settings);
  }, [runAi]);

  const onSave = useCallback(async () => {
    const l = loadedNow.current;
    const { owox, store, by, now, open, isAdmin } = latest.current;
    if (!l || !isAdmin || picksNow.current.length === 0 || savingNow.current) return;
    const staged = picksNow.current;
    const { settings: next, valid } = replay(l, staged);
    // a stale pick has nothing to write; it goes with the rest
    const written = new Set<Pick>(staged.filter((p) => !valid.some((v) => v.pick === p)));
    if (valid.length === 0) { setPicks(picksNow.current.filter((p) => !written.has(p))); return; }
    savingNow.current = true;
    setSaving(true);
    setMessage(null);
    const deps = { owox, store, by, now, open: open ?? (() => {}) };
    let ok = true;
    try {
      let settings = l.settings;
      const sets = valid.filter((v) => v.kind === 'set');
      if (sets.length) {
        const r = await runAction({ kind: 'set', next: () => next }, { ...deps, settings });
        if (!r.ok) {
          ok = false;
          if ('conflict' in r) setMessage(`${r.conflict.by ?? 'Someone'} changed setup${r.conflict.at ? ` at ${clock(r.conflict.at)}` : ''}. Reloaded.`);
          else setMessage(r.snippet ? `${r.error}\n${r.snippet}` : r.error);
          return;
        }
        settings = r.settings;
        for (const v of sets) written.add(v.pick);
        hold({ ...l, settings, derived: deriveModel(settings, l.graph) });
      }
      // appends and team writes take their text from the final draft rows, not from when they were picked
      const finalRows = rowsFor(l, settings, deriveModel(settings, l.graph), {}, new Set());
      for (const v of valid.filter((x) => x.kind !== 'set')) {
        const action = actionOf(finalRows.find((r) => r.id === v.pick.rowId), v.pick.optionId);
        if (!action || action.kind === 'set' || action.kind === 'open') { written.add(v.pick); continue; }
        const r = await runAction(action, { ...deps, settings });
        if (!r.ok) { ok = false; setMessage('conflict' in r ? 'Setup changed while saving. Reloaded.' : r.snippet ? `${r.error}\n${r.snippet}` : r.error); return; }
        written.add(v.pick);
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
    rows, loading, readOnly: !args.isAdmin, message, picked: Object.fromEntries((draft?.valid ?? []).map((v) => [v.pick.rowId, v.pick.optionId])),
    onPick, dirty: draft?.valid.length ?? 0, saving, onSave: () => void onSave(), onDiscard: () => { if (!savingNow.current) setPicks([]); },
    savedOpen, optionRows,
    onRetry: () => void reload().catch(() => undefined),
    onOpen: args.open && ((path) => latest.current.open?.(path)),
  };
  return { props, settings: loaded?.settings ?? null, reload };
}
