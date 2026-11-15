import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PRESET_GROUPS, PRESET_LABELS, type Preset, type ViewSettings, type WeekStart } from '../types';
import { SetupSaveControls, SetupTab, type SetupTabProps } from './SetupTab';

export type SettingsTab = 'general' | 'setup';
const TABS: { id: SettingsTab; label: string }[] = [{ id: 'general', label: 'General' }, { id: 'setup', label: 'Setup' }];

export function SettingsPage({ settings, onSave, onBack, error, tab: initialTab = 'general', onTabChange, setup }: {
  settings: ViewSettings; onSave: (s: ViewSettings) => void; onBack: () => void; error?: string | null;
  tab?: SettingsTab; onTabChange?: (t: SettingsTab) => void;
  /** What the Setup tab shows; the project-wide settings live there. */
  setup?: SetupTabProps | null;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const go = (t: SettingsTab) => { setTab(t); onTabChange?.(t); };
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    go(TABS[to]!.id);
    tabRefs.current[TABS[to]!.id]?.focus();
  };
  const page = useRef<HTMLDivElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  // the sticky top's height, for scroll-margin-top on rows and block headers, so a jump doesn't land under it
  useEffect(() => {
    const el = sticky.current; const root = page.current;
    if (!el || !root) return;
    const write = () => root.style.setProperty('--gy-sticky-h', `${el.offsetHeight}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [progressSlot, setProgressSlot] = useState<HTMLElement | null>(null);
  const [preset, setPreset] = useState<Preset | null>(settings.defaultPreset);
  const [weekStart, setWeekStart] = useState<WeekStart>(settings.weekStart);
  const [comparison, setComparison] = useState(settings.comparisonDefault);

  const save = () => onSave({ ...settings, defaultPreset: preset, comparisonDefault: comparison, weekStart });

  return (
    <div className="dm-page" ref={page}>
      <div className="gy-settings-sticky" ref={sticky}>
      <header className="dm-page-header gy-settings-header">
        <button type="button" className="gy-icon-btn" aria-label="Back" title="Back" onClick={onBack}><ArrowLeft size={16} /></button>
        <h1 className="dm-page-header-title">Settings</h1>
        {tab === 'setup' && setup && !setup.readOnly && <SetupSaveControls dirty={setup.dirty} saving={setup.saving} onSave={setup.onSave} onDiscard={setup.onDiscard} />}
      </header>
      <div className="gy-tabs" role="tablist" aria-label="Settings">
        {TABS.map((t, i) => (
          <button
            key={t.id} type="button" role="tab" id={`gy-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`gy-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[t.id] = el; }} className="gy-tab" onClick={() => go(t.id)} onKeyDown={(e) => onTabKey(e, i)}
          >{t.label}</button>
        ))}
      </div>
      {tab === 'setup' && <div className="gy-settings-progress" ref={setProgressSlot} />}
      </div>
      <main>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-setup" aria-labelledby="gy-tab-setup" hidden={tab !== 'setup'}>
          {setup && <SetupTab {...setup} progressSlot={progressSlot} />}
        </div>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-general" aria-labelledby="gy-tab-general" hidden={tab !== 'general'}>
          <form className="dm-card gy-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <fieldset className="gy-fieldset">
              <legend>Your view</legend>
              <div className="gy-field">
                <label htmlFor="gy-default-range">Default date range</label>
                <select id="gy-default-range" className="gy-select" value={preset ?? ''} onChange={(e) => setPreset(e.target.value === '' ? null : e.target.value as Preset)}>
                  <option value="">None (ontology view)</option>
                  {PRESET_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="dm-muted gy-field-hint">Only for you</span>
              </div>
              <div className="gy-field">
                <label htmlFor="gy-week-start">Week starts on</label>
                <select id="gy-week-start" className="gy-select" value={weekStart} onChange={(e) => setWeekStart(e.target.value as WeekStart)}>
                  <option value="monday">Monday</option>
                  <option value="sunday">Sunday</option>
                </select>
              </div>
              <label className="gy-check">
                <input type="checkbox" checked={comparison} onChange={(e) => setComparison(e.target.checked)} />
                Compare with previous period by default
              </label>
            </fieldset>
            {error && <p role="alert" className="gy-form-error">{error}</p>}
            <div className="gy-form-actions">
              <button type="submit" className="gy-btn gy-btn-primary">Save</button>
              <button type="button" className="gy-btn" onClick={onBack}>Cancel</button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
