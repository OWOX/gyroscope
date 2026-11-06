import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiCredentialHandle, PluginContext } from '@owox/plugin-sdk';
import type { Blocked as BlockedInfo, CacheDoc, CardCache, CompareChoice, Model, RangeChoice, ViewSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { EMPTY_SETUP } from './store/settings';
import { compareLabel, resolveRange } from './lib/dates';
import { describeError } from './lib/errors';
import { fetchMember } from './owox/role';
import { shownModel } from './model/shown';
import type { Derived, Graph } from './model/derive';
import { aiGenerateWith, type GenerateWith } from './setup/ai';
import { useSetup } from './setup/useSetup';
import { fetchQuality, type QualitySummary } from './owox/quality';
import type { Inputs, MartDetail, OwoxLike } from './owox/sources';
import { cacheKey, persistable, refreshCanvas } from './metrics/refresh';
import { cachedOwox } from './cache/martCache';
import {
  loadPreferences, loadViewSettings, savePreferences, saveViewSettings, type CollectionsLike,
} from './store/collections';
import { Blocked } from './ui/Blocked';
import { Canvas } from './ui/Canvas';
import { createMarkdownHtml } from './lib/markdown';
import { LoadingBar } from './ui/LoadingBar';
import { Header, RangeControls } from './ui/Header';
import { LeaveDialog } from './ui/LeaveDialog';
import { SettingsPage, type SettingsTab } from './ui/SettingsPage';

export interface AppDeps {
  owox: OwoxLike;
  store: CollectionsLike;
  /** The AI handle for Setup recommendations (the credential's fast tier); null without a credential. */
  generateWith?: GenerateWith | null;
  userId: string;
  now: () => Date;
}

type View =
  | { name: 'loading' }
  | { name: 'blocked'; blocked: BlockedInfo }
  | { name: 'error'; message: string; retry: 'load' | 'none' }
  | { name: 'ready' }
  | { name: 'settings'; tab: SettingsTab };

export function depsFrom(ctx: PluginContext): AppDeps {
  // recommendations are quick picks among options code listed, so they run on the fast tier;
  // installs published before 0.3.1 declare only fast, and installs with only reasoning use that
  const handle = ctx.credentials?.ai as AiCredentialHandle | undefined;
  const ai = handle?.fast ?? handle?.reasoning;
  return {
    owox: ctx.owox as unknown as OwoxLike,
    store: ctx as unknown as CollectionsLike,
    generateWith: ai ? aiGenerateWith(ai, ctx.signal) : null,
    userId: ctx.userId,
    now: () => new Date(),
  };
}

const ROUTES: Record<SettingsTab, string> = { general: '/settings', setup: '/settings/setup', schedules: '/settings/schedules' };
/** The settings tab a route opens; anything else opens the canvas. */
const tabOf = (route: string | undefined): { tab: SettingsTab } | null => {
  const path = route?.replace(/\/+$/, '');
  // the Metrics and Checkup tabs moved into Setup
  if (path === '/settings/checkup' || path === '/settings/ontology') return { tab: 'setup' };
  const tab = (Object.keys(ROUTES) as SettingsTab[]).find((t) => ROUTES[t] === path);
  return tab ? { tab } : null;
};

/** No default preset means no range: the ontology view. */
const rangeOf = (s: ViewSettings): RangeChoice | null => (s.defaultPreset ? { kind: 'preset', preset: s.defaultPreset } : null);
const compareOf = (s: ViewSettings): CompareChoice => (s.comparisonDefault ? { kind: 'preset', preset: 'previous_period' } : { kind: 'off' });

/** The previous doc for the key with the new cards laid over it, metric by metric; a spark is replaced once its new one arrives. */
function mergePartial(base: CacheDoc | null, cards: Record<string, CardCache>, model: Model, anchor: string, thresholdPct: number, key: string, comparison: boolean): CacheDoc {
  const merged: Record<string, CardCache> = { ...base?.cards };
  for (const [id, c] of Object.entries(cards)) {
    const old = base?.cards[id];
    // the old spark stays until the key metric's new result lands; a secondary one until that metric's does
    const key = model.classes.find((x) => x.id === id)?.keyMetricId;
    const keyDone = !!key && key in c.metrics;
    const sparks = Object.fromEntries(Object.entries({ ...old?.sparks, ...c.sparks }).filter(([m]) => !(m in c.metrics) || !!c.sparks?.[m]));
    merged[id] = { metrics: { ...old?.metrics, ...c.metrics }, spark: keyDone ? c.spark : old?.spark ?? null, ...(Object.keys(sparks).length ? { sparks } : {}) };
  }
  return {
    modelHash: model.inputHash, builtAt: model.builtAt, editedAt: model.editedAt, thresholdPct, anchor,
    refreshedAt: base?.refreshedAt ?? new Date().toISOString(), key, comparison, cards: merged,
  };
}

export function App({ ctx, deps: injected }: { ctx: PluginContext; deps?: AppDeps }) {
  const [deps] = useState(() => injected ?? depsFrom(ctx));
  const { owox, store, generateWith = null, userId, now } = deps;

  const [view, setView] = useState<View>({ name: 'loading' });
  // a reload lands on the settings tab the route names; read once, the first load only
  const startTab = useRef(tabOf(ctx.route));
  const [model, setModel] = useState<Model | null>(null);
  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_SETTINGS);
  const [range, setRange] = useState<RangeChoice | null>(() => rangeOf(DEFAULT_SETTINGS));
  const [compare, setCompare] = useState<CompareChoice>(() => compareOf(DEFAULT_SETTINGS));
  const [cache, setCache] = useState<CacheDoc | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // loading: the line and step text show, from the first screen until the refresh ends; progress: metrics done of total, once known
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // the editor's display name, stored as the settings' updatedBy
  const [editor, setEditor] = useState<string | null>(null);
  // what this member can see, read with the Setup graph; the Data Mart schemas it read are kept for the cards
  const [inputs, setInputs] = useState<{ model: Model; data: Inputs | null } | null>(null);
  const [schemas, setSchemas] = useState<{ model: Model; details: Map<string, MartDetail> } | null>(null);
  const refreshId = useRef(0);
  const [quality, setQuality] = useState<{ model: Model; data: Map<string, QualitySummary> | null } | null>(null);
  const qualityFor = useRef<Model | null>(null);
  const modelNow = useRef<Model | null>(null);
  const viewNow = useRef<View>(view);
  modelNow.current = model;
  viewNow.current = view;
  const cacheNow = useRef<CacheDoc | null>(null);
  cacheNow.current = cache;
  // bumped once the member and view settings are in, so Setup loads with the right role
  const [loadedTick, setLoadedTick] = useState(0);

  const onModel = useCallback((d: Derived, graph: Graph) => {
    if (!d.ok) {
      setModel(null);
      modelNow.current = null;
      // a blocked model on the Settings page stays there: Setup is where it gets fixed
      const tab = startTab.current;
      startTab.current = null;
      setView((v) => (v.name === 'settings' ? v : tab ? { name: 'settings', ...tab } : { name: 'blocked', blocked: d.blocked }));
      return;
    }
    // equal settings and schemas give an equal hash: the canvas keeps its model, its cache and its numbers
    const next = modelNow.current && modelNow.current.inputHash === d.model.inputHash ? modelNow.current : d.model;
    modelNow.current = next;
    setModel(next);
    setInputs({ model: next, data: graph.inputs });
    setSchemas({ model: next, details: new Map(graph.nodes.map((n) => [n.id, n.detail])) });
    const tab = startTab.current;
    startTab.current = null;
    setView((v) => (v.name === 'settings' ? v : tab ? { name: 'settings', ...tab } : { name: 'ready' }));
  }, []);

  // an exit with staged Setup picks asks first; the picks would be lost
  const dirtyNow = useRef(0);
  const savingNow = useRef(false);
  // `save`: the exit is General's Save, which drops the picks itself once it has succeeded
  const [leaving, setLeaving] = useState<{ go: () => void; save: boolean } | null>(null);
  // a Setup save in flight holds the exits: the picks and the error stay where the user can see them
  const guard = (go: () => void, save = false) => {
    if (savingNow.current) return;
    if (dirtyNow.current > 0) setLeaving({ go, save }); else go();
  };
  const navigate = ctx.ui?.navigate ? (path: string) => guard(() => ctx.ui.navigate(path)) : undefined;

  const setup = useSetup({
    owox, store, generateWith, isAdmin, by: editor ?? userId, projectId: ctx.projectId, now,
    open: navigate, onModel,
  });
  dirtyNow.current = setup.props.dirty;
  savingNow.current = setup.props.saving;
  // nothing left to lose: the dialog closes and the exit goes on
  useEffect(() => {
    if (setup.props.dirty > 0 || !leaving) return;
    setLeaving(null);
    leaving.go();
  }, [setup.props.dirty, leaving]);
  const isDirty = setup.props.dirty > 0;
  // the host warns on its own exits (sidebar, Back, closing the tab) once it offers setUnsaved
  const host = ctx.ui as { setUnsaved?: (dirty: boolean) => void } | undefined;
  const hostNow = useRef(host);
  hostNow.current = host;
  const told = useRef(false);
  useEffect(() => {
    if (isDirty === told.current) return;
    told.current = isDirty;
    hostNow.current?.setUnsaved?.(isDirty);
  }, [isDirty]);
  useEffect(() => () => { if (told.current) hostNow.current?.setUnsaved?.(false); }, []);
  const thresholdPct = setup.settings?.thresholdPct ?? EMPTY_SETUP.thresholdPct;

  const load = useCallback(async () => {
    setView({ name: 'loading' });
    try {
      const [s, prefs, member] = await Promise.all([loadViewSettings(store), loadPreferences(store).catch(() => null), fetchMember(owox)]);
      setEditor(member.name);
      setIsAdmin(member.isAdmin);
      setSettings(s);
      // every open starts on the member's default range (none by default: the ontology view); only the comparison choice is remembered
      setRange(rangeOf(s));
      setCompare(prefs?.compare ?? compareOf(s));
      setLoadedTick((t) => t + 1);
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: 'load' });
    }
  }, [store, owox]);
  useEffect(() => { void load(); }, [load]);

  // Setup reads the role set above, so it starts a render later; its failure is the load's
  const reloadSetup = setup.reload;
  useEffect(() => {
    if (loadedTick === 0) return;
    reloadSetup().catch((e) => setView({ name: 'error', message: describeError(e), retry: 'load' }));
  }, [loadedTick, reloadSetup]);

  const visible = useMemo<ReadonlySet<string> | null>(
    // a failed access check shows nothing rather than everything
    () => (inputs && inputs.model === model ? new Set(inputs.data?.marts.map((m) => m.id) ?? []) : null),
    [inputs, model],
  );

  const periodShown = useMemo(() => {
    if (!range) return undefined;
    const spec = resolveRange(range, compare, now(), settings.weekStart);
    // with a comparison, show the windows actually compared: the days so far (cut when it is shorter), not the whole range;
    // a projected range is compared whole, so it shows whole
    const fact = spec.forecastWindow ? spec.range : spec.compareFact ?? spec.factWindow;
    return spec.comparison && fact ? { range: fact, comparison: spec.comparison } : { range: spec.range, comparison: null };
  }, [range, compare, now, settings.weekStart]);

  const marts = useMemo(
    () => new Map((inputs?.data?.marts ?? []).map((m) => [m.id, { title: m.title, description: m.description, icon: m.icon ?? null }])),
    [inputs],
  );

  const markdown = useMemo(() => createMarkdownHtml(owox.markdown ? (r) => owox.markdown!.parseToHtml(r) : undefined), [owox]);
  const detailsNow = useMemo(() => (schemas && schemas.model === model ? schemas.details : undefined), [schemas, model]);

  const refresh = useCallback(async (force: boolean): Promise<boolean> => {
    if (!model || !range) return false;
    const id = ++refreshId.current;
    const current = () => id === refreshId.current;
    const at = now();
    const spec = resolveRange(range, compare, at, settings.weekStart);
    const key = cacheKey(range, compare, settings.weekStart);
    const keep = persistable(range, compare);
    try {
      setCache((c) => (c?.key === key ? c : null));
      // the doc on screen keeps its numbers until a new result replaces them
      const shown = cacheNow.current?.key === key ? cacheNow.current : null;
      setLoading(true);
      setProgress(null);
      setRefreshing(true);
      // custom choices are not persisted: they compute live and stay in state only
      const src = keep ? cachedOwox({ owox, store, anchor: spec.anchor, mode: force ? 'write-only' : 'read-write', now }) : null;
      const doc = await refreshCanvas({
        owox: src?.owox ?? owox, model, spec, key, thresholdPct: thresholdPct, visibleIds: visible, details: detailsNow,
        onProgress: (done, total) => { if (current()) setProgress({ done, total }); },
        onPartial: (cards) => { if (current()) setCache(mergePartial(shown, cards, shownModel(model, detailsNow), spec.anchor, thresholdPct, key, spec.comparison !== null)); },
      });
      if (!current()) return false;
      // the header shows the age of the oldest cached answer
      setCache(src ? { ...doc, refreshedAt: src.stats().oldestHit ?? doc.refreshedAt } : doc);
      setSaveNote(null);
      if (src) {
        const f = await src.flush();
        const unsaved = f.failed.length + f.tooLarge.length;
        if (current() && unsaved) setSaveNote(`Couldn't save the refreshed data for ${unsaved} Data Mart(s).`);
      }
    } catch {
      // cards keep their last cached values
    } finally {
      if (current()) { setRefreshing(false); setLoading(false); setProgress(null); }
    }
    return current();
  }, [model, range, compare, owox, store, now, thresholdPct, settings.weekStart, visible, detailsNow]);

  const inReady = view.name === 'ready';
  const inSettings = view.name === 'settings';
  useEffect(() => {

  // data-quality icons: one call per canvas load, never cached; a failure leaves the cards without them
  useEffect(() => {
    if (!inReady || !model || !range || qualityFor.current === model) return;
    qualityFor.current = model;
    void fetchQuality(owox, [...new Set(model.classes.map((c) => c.martId))]).then((data) => { if (qualityFor.current === model) setQuality({ model, data }); });
  }, [inReady, model, range, owox]);

  const inputsReady = inReady && !!inputs && inputs.model === model;
  useEffect(() => {
    if (!inputsReady || !model || !range) return;
    void refresh(false);
  }, [inputsReady, inputs, model, refresh, range]);

  const openSettings = (tab: SettingsTab = 'general') => { ctx.ui?.setRoute?.(ROUTES[tab]); setSettingsError(null); setView({ name: 'settings', tab }); };
  const leaveSettings = () => {
    ctx.ui?.setRoute?.('/');
    // blocked or not, the canvas or the blocked screen is what Setup last derived
    setView(modelNow.current ? { name: 'ready' } : { name: 'loading' });
    if (!modelNow.current) void setup.reload().catch((e) => setView({ name: 'error', message: describeError(e), retry: 'load' }));
  };
  const backToCanvas = model ? () => setView({ name: 'ready' }) : undefined;
  // Fire and forget: losing the remembered choice must not disturb the canvas. The doc keeps its 0.4 shape; its range is always null.
  const remember = (c: CompareChoice) => { void savePreferences(store, { range: null, compare: c }).catch(() => undefined); };
  const changeRange = (r: RangeChoice | null, c: CompareChoice) => {
    // Clear keeps the compare choice so it comes back
    const next = c;
    if (r === null) { refreshId.current++; setRefreshing(false); setLoading(false); setProgress(null); }
    setRange(r); setCompare(next); remember(next);
  };
  const saveSettingsAndLeave = async (s: ViewSettings, discardSetup = false) => {
    try {
      await saveViewSettings(store, { defaultPreset: s.defaultPreset, comparisonDefault: s.comparisonDefault, weekStart: s.weekStart });
    } catch (e) {
      setSettingsError(`Couldn't save settings: ${describeError(e)}`);
      return;
    }
    const nextRange = s.defaultPreset !== settings.defaultPreset ? rangeOf(s) : range;
    const nextCompare = s.comparisonDefault !== settings.comparisonDefault ? compareOf(s) : compare;
    if (nextRange !== range || nextCompare !== compare) { setRange(nextRange); setCompare(nextCompare); remember(nextCompare); }
    setSettings(s);
    if (discardSetup && dirtyNow.current > 0) setup.props.onDiscard();
    leaveSettings();
  };

  const body = (() => { switch (view.name) {
    case 'loading':
      return <main className="gy-main"><LoadingBar /><p className="gy-muted gy-loadnote">Loading settings and model…</p></main>;
    case 'blocked':
      return <Blocked blocked={view.blocked} projectId={ctx.projectId} isAdmin={isAdmin} onRetry={() => void load()} onOpenSetup={() => openSettings('setup')} onBack={backToCanvas} onOpen={navigate} />;
    case 'error':
      return (
        <main className="gy-main">
          <h1>Something went wrong</h1>
          <p>{view.message}</p>
          {view.retry !== 'none' && <button type="button" className="gy-btn gy-btn-primary" onClick={() => void load()}>Retry</button>}
          {backToCanvas && <>{' '}<button type="button" className="gy-btn" onClick={backToCanvas}>Back to canvas</button></>}
        </main>
      );
    case 'settings':
      return (
        <SettingsPage
          settings={settings}
          tab={view.tab}
          onTabChange={(t) => ctx.ui?.setRoute?.(ROUTES[t])}
          setup={setup.props}
          schedules={{ schedules: ctx.schedules, model, settings }}
          onBack={() => guard(leaveSettings)}
          error={settingsError}
          onSave={(s) => guard(() => void saveSettingsAndLeave(s, true), true)}
        />
      );
    case 'ready': {
      if (!model) return null;
      const status = range && (loading || refreshing) ? (progress ? `Loading metrics ${progress.done} of ${progress.total}` : inputsReady ? 'Loading metrics…' : 'Reading Data Marts…') : null;
      return (
        <main className="gy-main">
          <Header cache={cache} now={now()} period={periodShown} status={status} noRange={!range} />
          {saveNote && <p className="gy-muted">{saveNote}</p>}
          {inputs && inputs.model === model && !inputs.data && <p className="gy-muted" role="alert">Couldn't check which Data Marts you can access. Reopen Gyroscope to try again.</p>}
          <Canvas
            mode={range ? 'flow' : 'ontology'}
            tools={<RangeControls range={range} compare={range === null && compare.kind === 'off' ? compareOf(settings) : compare} now={now()} weekStart={settings.weekStart} refreshing={refreshing} onChange={changeRange} onRefresh={() => void refresh(true)} onSettings={() => openSettings()} />}
            model={model} cache={cache} visibleIds={visible} details={detailsNow} marts={marts}
            compareLabel={range ? compareLabel(range, compare, now(), settings.weekStart) ?? undefined : undefined}
            progress={progress}
            quality={quality?.model === model ? quality.data : null}
            projectId={ctx.projectId}
            markdown={markdown}
            weekStart={settings.weekStart}
            onOpen={navigate}
            comparisonOn={!!range && compare.kind !== 'off'} refreshing={refreshing || loading} onRetry={() => void refresh(true)}
          />
        </main>
      );
    }
  } })();
  return (
    <>
      {body}
      {leaving && <LeaveDialog changes={setup.props.dirty} save={leaving.save} onStay={() => setLeaving(null)} onLeave={() => { const { go, save } = leaving; setLeaving(null); if (!save) setup.props.onDiscard(); go(); }} />}
    </>
  );
}
