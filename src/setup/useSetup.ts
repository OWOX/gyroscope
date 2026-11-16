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
import { dismiss, undismiss } from './rows/common';
import { hashString } from '../lib/hash';
import type { Action, Row } from './types';

export interface UseSetupArgs {
  owox: OwoxLike; store: CollectionsLike; generateWith: GenerateWith | null; isAdmin: boolean; by: string; projectId: string;
  now: () => Date; open?: (path: string) => void; onModel: (d: Derived, graph: Graph) => void;
}

/** A staged choice: the option picked on a row. What it does is looked up in the draft rows each time. */
interface Pick { rowId: string; optionId: string }

interface Valid { pick: Pick; kind: Action['kind']; row: Row }

interface Replayed { settings: ProjectSettingsV5; derived: Derived; valid: Valid[]; overridden: string[]; stale: Pick[] }

interface Loaded { settings: ProjectSettingsV5; graph: Graph; legacyCore: string[]; derived: Derived; hash: string }

/** A short fingerprint of a row's option ids: a stored pick is dropped when the options change. */
const fingerprint = (row: Row): string => hashString(row.options.map((o) => o.id).sort().join('|')).slice(0, 8);
const keyOf = (row: Row) => `${row.id}#${fingerprint(row)}`;

const clock = (at: string | null): string => {
  const t = at ? new Date(at) : null;
  return t && !Number.isNaN(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
};

/** Settings as sorted JSON without the save stamp, to tell whether a change changes anything. */
const stable = (v: unknown): string => JSON.stringify(v, (k, x) => (k === 'updatedAt' || k === 'updatedBy' ? undefined : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));

const actionOf = (row: Row | undefined, optionId: string): Action | undefined => {
  if (optionId === 'dismiss') return row?.dismissable ? { kind: 'set', next: (s) => dismiss(s, row.id) } : undefined;
  if (optionId === 'undismiss') return row?.dismissed ? { kind: 'set', next: (s) => undismiss(s, row.id) } : undefined;
  if (optionId.startsWith('shown:set:')) {
    const a = row?.multi?.action(optionId.slice(10).split('|').filter(Boolean));
    return a?.kind === 'set' ? { kind: 'set', next: (s) => undismiss(a.next(s), row!.id) } : undefined;
  }
  const o = row?.options.find((x) => x.id === optionId);
  // a real answer ends a dismissal; an option that declines is a dismissal itself
  return o && row && o.action.kind === 'set' && !o.declines ? { kind: 'set', next: (s) => undismiss((o.action as { next: (s: ProjectSettingsV5) => ProjectSettingsV5 }).next(s), row.id) } : o?.action;
};

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
  const [saveCount, setSaveCount] = useState(0);
  const savingNow = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // set by a user pick: the next draft may name what that pick overrode; a reload or a prune never does
  const pickedNow = useRef(false);
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
    pickedNow.current = false;
    setNotice(null);
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

  /**
   * Replays the picks over the saved settings: each runs against the rows the earlier ones produced, and a stale one (its row or option is gone) is skipped
   * and returned in `stale`. A `set` pick a later pick undid is dropped, replayed without, and named in `overridden`. Undone means: applying it again to the
   * result would change its own row's answer (state or current value), or its row was sound right after it ran and is broken in the result. Changes it
   * makes to other rows don't count. `seen` caches rows per settings across the recursion.
   */
  const replay = (l: Loaded, staged: Pick[], seen = new Map<string, Row[]>()): Replayed => {
    const rowsOf = (s: ProjectSettingsV5, key = stable(s), d?: Derived): Row[] => {
      let r = seen.get(key);
      if (!r) { r = rowsFor(l, s, d ?? deriveModel(s, l.graph), {}, new Set()); seen.set(key, r); }
      return r;
    };
    const bad = (r: Row | undefined) => r?.state === 'broken' || r?.state === 'error';
    let settings = l.settings;
    let derived = l.derived;
    let key = stable(settings);
    const valid: Valid[] = [];
    const stale: Pick[] = [];
    // whether each `set` pick's row was sound right after it ran
    const sound = new Map<Pick, boolean>();
    for (const pick of staged) {
      // the row as it stood when this pick ran: its options are what the pick chose from
      const row = rowsOf(settings, key, derived).find((r) => r.id === pick.rowId);
      const action = actionOf(row, pick.optionId);
      if (!action || action.kind === 'open') { stale.push(pick); continue; }
      valid.push({ pick, kind: action.kind, row: row! });
      if (action.kind === 'set') {
        settings = action.next(settings); derived = deriveModel(settings, l.graph); key = stable(settings);
        sound.set(pick, !bad(rowsOf(settings, key, derived).find((r) => r.id === pick.rowId)));
      }
    }
    const done = key;
    const final = rowsOf(settings, done, derived);
    const answer = (rows: Row[], id: string) => { const r = rows.find((x) => x.id === id); return r ? `${r.state}|${r.current}` : ''; };
    const undone = valid.filter((v) => {
      const a = actionOf(v.row, v.pick.optionId);
      if (a?.kind !== 'set') return false;
      if (sound.get(v.pick) && bad(final.find((r) => r.id === v.pick.rowId))) return true;
      const after = a.next(settings);
      const k = stable(after);
      return k !== done && answer(rowsOf(after, k), v.pick.rowId) !== answer(final, v.pick.rowId);
    });
    if (undone.length === 0) return { settings, derived, valid, overridden: [], stale };
    const again = replay(l, staged.filter((p) => !undone.some((v) => v.pick === p)), seen);
    return { ...again, overridden: [...undone.map((v) => v.row.title), ...again.overridden] };
  };

  // the draft: the saved settings with every staged `set` applied in pick order; the rows and the model follow it
  const draft = useMemo(() => {
    if (!loaded) return null;
    if (picks.length === 0) return { settings: loaded.settings, derived: loaded.derived, valid: [], overridden: [], stale: [] } as Replayed;
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
      return pick !== undefined && r.options.some((o) => o.id === pick) ? { ...r, options: r.options.map((o) => ({ ...o, recommended: o.id === pick })) } : r;
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
      // rows the saved settings leave unanswered; a row that only exists in the draft counts when the draft leaves it open too
      savedOpen: new Set(rows.filter((r) => (byId.get(r.id) ?? r).state !== 'done').map((r) => r.id)),
      // a picked row offers the options its pick chose from, so its radios hold still while later picks change the draft
      optionRows: Object.fromEntries([...ranOn].map(([id, r]) => [id, { ...withAi(r), aiPending: live.find((x) => x.id === id)?.aiPending ?? false }])),
    };
  }, [loaded, draft, picks, cached, pending, args.projectId, args.generateWith]);
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  // every row title seen, to name a pick whose row a later pick removed
  const titles = useRef(new Map<string, string>());
  for (const r of rows) titles.current.set(r.id, r.title);
  const optionsNow = useRef(optionRows);
  optionsNow.current = optionRows;
  // a stale or overridden pick is dropped for good, so it can't come back when its row does
  useEffect(() => {
    if (!draft || saving || picks !== picksNow.current) return;
    const keep = picksNow.current.filter((p) => draft.valid.some((v) => v.pick === p));
    if (keep.length !== picksNow.current.length) setPicks(keep);
  }, [draft, picks, saving]);
  // a pick that undid an earlier one names it, until the next pick, Discard, Save or reload
  useEffect(() => {
    if (!draft || !pickedNow.current) return;
    pickedNow.current = false;
    const names = [...draft.overridden, ...draft.stale.map((p) => titles.current.get(p.rowId) ?? p.rowId)];
    if (names.length) setNotice(`A later choice replaced your choice for ${[...new Set(names)].join(', ')}.`);
  }, [draft]);
  // the draft can bring new rows that want an AI pick
  useEffect(() => { if (loaded && draft && picks.length) void runAi(loaded, draft.settings); }, [loaded, draft, picks, runAi]);

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
      // an option that changes nothing against the saved settings is not a change either
      const noop = action.kind === 'set' && stable(action.next(l.settings)) === stable(l.settings);
      if (!opt?.keep && !noop) {
        const i = cur.findIndex((p) => p.rowId === rowId);
        // a re-pick keeps the row's place in the order
        next = i >= 0 ? cur.map((p, j) => (j === i ? { rowId, optionId } : p)) : [...cur, { rowId, optionId }];
      }
    }
    setNotice(null);
    pickedNow.current = true;
    setPicks(next);
  }, []);

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
    pickedNow.current = false;
    setNotice(null);
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
      else setSaveCount((c) => c + 1);
      savingNow.current = false;
      setSaving(false);
    }
  }, [reload]);

  const props: SetupTabProps = {
    rows, loading, readOnly: !args.isAdmin, message, picked: Object.fromEntries((draft?.valid ?? []).map((v) => [v.pick.rowId, v.pick.optionId])),
    onPick, dirty: draft?.valid.length ?? 0, saving, onSave: () => void onSave(), onDiscard: () => { if (!savingNow.current) { pickedNow.current = false; setPicks([]); setNotice(null); } }, notice,
    savedOpen, optionRows, saveCount,
    martIcons: Object.fromEntries((loaded?.graph.inputs.marts ?? []).map((m) => [m.id, m.icon ?? null])),
    onRetry: () => void reload().catch(() => undefined),
    onOpen: args.open && ((path) => latest.current.open?.(path)),
  };
  return { props, settings: loaded?.settings ?? null, reload };
}
