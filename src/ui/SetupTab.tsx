import { ChevronDown, Tags } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BLOCKS } from '../setup/catalog';
import { isOpen, progress } from '../setup/progress';
import type { BlockInfo, Row, Severity } from '../setup/types';
import { CollapsibleCard } from './CollapsibleCard';
import { HintBubble, HintButton } from './Hint';
import { LoadingBar } from './LoadingBar';
import { MartIcon } from './MartIcon';
import { ProgressBar, ProgressLegend } from './ProgressBar';
import { SetupRow } from './SetupRow';

export interface SetupTabProps {
  rows: Row[]; loading: boolean; readOnly: boolean; message: string | null;
  /** Staged choices: row id to option id; 'dismiss' stands for dismissing a notice. */
  picked: Record<string, string>; onPick: (rowId: string, optionId: string | null) => void;
  dirty: number; saving: boolean; onSave: () => void; onDiscard: () => void;
  /** The rows not done in the saved settings: they show the radio list and seed their hint open. */
  savedOpen: ReadonlySet<string>;
  /** For a row with a staged pick: the row as that pick ran against it. Its radios, their order and the recommendation come from here. */
  optionRows?: Record<string, Row>;
  /** A line under the Save bar, e.g. which staged choice a later one replaced. */
  notice?: string | null;
  /** Counts successful saves; an open "Change" closes on each. */
  saveCount?: number;
  /** Data Mart id to its icon (a recommended key, `lucide:<name>` or null), for the group headers. */
  martIcons?: Record<string, string | null>;
  onRetry: () => void; onOpen?: (path: string) => void;
  /** Where the progress bar goes (a slot in the page's sticky top). `undefined` keeps it inline; `null` means the slot isn't there, so no bar. */
  progressSlot?: HTMLElement | null;
}

/** The change count, Discard and Save. SettingsPage puts these in the page header. */
export function SetupSaveControls({ dirty, saving, onSave, onDiscard }: Pick<SetupTabProps, 'dirty' | 'saving' | 'onSave' | 'onDiscard'>) {
  return (
    <div className="gy-save">
      {dirty > 0 && <span className="gy-muted">{dirty === 1 ? '1 change' : `${dirty} changes`}</span>}
      {dirty > 0 && <button type="button" className="gy-link" disabled={saving} onClick={onDiscard}>Discard</button>}
      <button type="button" className="gy-btn gy-btn-primary" disabled={dirty === 0 || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

const ORDER: Severity[] = ['error', 'warning', 'notice'];
const WORD: Record<Severity, [string, string]> = { error: ['blocker', 'blockers'], warning: ['recommended', 'recommended'], notice: ['notice', 'notices'] };

function Block({ info, rows, folded, hintOpen, onHint, attention, children }: { info: BlockInfo; rows: Row[]; folded: boolean; hintOpen: boolean; onHint: () => void; attention: boolean; children: React.ReactNode }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const open = rows.filter(isOpen);
  const worst = ORDER.find((s) => open.some((r) => r.severity === s));
  const n = worst ? open.filter((r) => r.severity === worst).length : 0;
  // only a blocker or a recommendation tints the tile; notices leave it neutral
  const tint = worst === 'notice' ? null : worst ?? null;
  const label = worst ? `${n} ${WORD[worst][n === 1 ? 0 : 1]} left` : 'All set';
  return (
    <CollapsibleCard variant="band" icon={info.icon} iconSeverity={tint} iconLabel={label} label={info.title} collapsed={folded} attention={attention}
      title={<span className="gy-setup-title"><span className="gy-setup-name">{info.title}</span><HintButton title={info.title} id={hintId} open={hintOpen} onToggle={onHint} anchor={anchor} /></span>}
      hint={<HintBubble id={hintId} open={hintOpen} anchor={anchor}>{`${info.question} ${info.why}`}</HintBubble>}>
      {children}
    </CollapsibleCard>
  );
}

export function SetupTab({ rows, loading, readOnly, message, picked, onPick, saving, savedOpen, optionRows, notice, saveCount, martIcons, onRetry, onOpen, progressSlot }: SetupTabProps) {
  // a staged append or team write is done as far as the bar goes: it changes no setting, so the rows can't show it
  const eff = rows.map((r) => {
    const k = r.options.find((o) => o.id === picked[r.id])?.action.kind;
    return k === 'append' || k === 'teams' ? { ...r, state: 'done' as const } : r;
  });
  // the row a jump is heading for; its block opens through the card's `attention`, then the effect opens its group and focuses it
  const [target, setTarget] = useState<Row | null>(null);
  const jump = (s: Severity) => setTarget(eff.find((r) => isOpen(r) && r.severity === s) ?? null);
  // a hint opens when its row or block was unanswered when first seen; after that only clicks toggle it
  const seed = useRef(new Map<string, boolean>());
  const [clicked, setClicked] = useState<Record<string, boolean>>({});
  const seeded = (id: string, initial: boolean) => { if (!seed.current.has(id)) seed.current.set(id, initial); return seed.current.get(id)!; };
  const hintOpen = (id: string, initial: boolean) => clicked[id] ?? seeded(id, initial);
  const toggle = (id: string, initial: boolean) => setClicked((c) => ({ ...c, [id]: !(c[id] ?? seeded(id, initial)) }));
  useEffect(() => {
    if (!target) return;
    const el = [...document.querySelectorAll<HTMLElement>('[data-row-id]')].find((e) => e.dataset.rowId === target.id);
    const group = el?.closest('details');
    if (group) group.open = true;
    setTarget(null);
    // the card unfolds on the next render, and a folded (inert) row can't take focus yet
    setTimeout(() => {
      el?.scrollIntoView?.({ block: 'start' });
      (el?.querySelector<HTMLElement>('input[type="radio"]') ?? el?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    }, 0);
  }, [target]);
  const renderRow = (r: Row) => (
    <SetupRow key={r.id} row={r} readOnly={readOnly} picked={picked[r.id]} unset={savedOpen.has(r.id)} optionRow={optionRows?.[r.id]} saving={saving} saveCount={saveCount} martIcons={martIcons}
      hintOpen={hintOpen(r.id, savedOpen.has(r.id))} onHint={() => toggle(r.id, savedOpen.has(r.id))}
      onPick={(o) => onPick(r.id, o)} onRetry={onRetry} onOpen={onOpen} />
  );
  const counts = progress(eff);
  // a save error and the notice travel with the bar: with Save in the sticky header, a message has to stay in view too. The bar is the header's bottom edge.
  const top = (
    <>
      {(message || notice) && <div className="gy-setup-notes">
      {message && (
        <div className="gy-setup-banner" role="status">
          <span>{message}</span>
          <button type="button" className="gy-btn" onClick={onRetry}>Retry</button>
        </div>
      )}
      {notice && <p className="gy-muted gy-save-notice" role="status">{notice}</p>}
      </div>}
      <ProgressBar counts={counts} />
    </>
  );
  return (
    <div className="gy-setup">
      {loading && <LoadingBar />}
      {progressSlot === undefined ? top : progressSlot && createPortal(top, progressSlot)}
      <ProgressLegend counts={counts} onJump={jump} />
      <div className="gy-setup-blocks">
      {BLOCKS.map((b) => {
        const mine = eff.filter((r) => r.block === b.id);
        if (mine.length === 0) return null;
        const groups = [...new Set(mine.filter((r) => r.group).map((r) => r.group!))];
        const loose = mine.filter((r) => !r.group);
        const initial = mine.some((r) => savedOpen.has(r.id));
        const id = `block:${b.id}`;
        const cells = groups.map((g) => {
          const inGroup = mine.filter((r) => r.group === g);
          const gid = inGroup.find((r) => r.groupId)?.groupId;
          return (
            <details key={g} className="gy-setup-group" open={inGroup.some((r) => savedOpen.has(r.id))}>
              <summary>
                <span className="gy-setup-group-icon" aria-hidden="true">{gid !== undefined ? <MartIcon icon={martIcons?.[gid] ?? null} size={16} aria-hidden="true" /> : <Tags size={16} aria-hidden="true" />}</span>
                <span className="gy-setup-group-name">{g}</span>
                <ChevronDown size={12} className="gy-setup-group-chevron" aria-hidden="true" />
              </summary>
              {inGroup.map(renderRow)}
            </details>
          );
        });
        return (
          <Block key={b.id} info={b} rows={mine} folded={!initial} hintOpen={hintOpen(id, initial)} onHint={() => toggle(id, initial)} attention={target?.block === b.id}>
            {loose.map(renderRow)}
            {b.id === 'teams' ? <div className="gy-setup-groups">{cells}</div> : cells}
          </Block>
        );
      })}
      </div>
    </div>
  );
}
