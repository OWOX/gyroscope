import { Check, Loader2, SquareArrowOutUpRight } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { Option, Row } from '../setup/types';
import { HintBubble, HintButton } from './Hint';

const SHOWN = 3;

export interface SetupRowProps {
  row: Row; readOnly: boolean;
  /** The staged option for this row, if any. */
  picked?: string;
  /** The row had no saved value: it shows the radio list. */
  unset: boolean;
  /** What the row showed in the saved settings, for its "Keep ..." radio. */
  savedCurrent?: string | null;
  hintOpen: boolean; onHint: () => void;
  onPick: (optionId: string | null) => void; onRetry: () => void; onOpen?: (path: string) => void;
}

/** One setup question: the value now, and for an unanswered row (or on "Change") a radio list of the ways to answer it. */
export function SetupRow({ row, readOnly, picked, unset, savedCurrent, hintOpen, onHint, onPick, onRetry, onOpen }: SetupRowProps) {
  const [changing, setChanging] = useState(false);
  const [more, setMore] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const choices = row.options.filter((o) => o.action.kind !== 'open');
  const links = row.options.filter((o) => o.action.kind === 'open');
  // the recommended option first; `recommend()` only flags it
  const ordered = [...choices.filter((o) => o.recommended), ...choices.filter((o) => !o.recommended)];
  const rec = ordered.find((o) => o.recommended);
  const detailTone = row.state === 'error' || row.severity === 'error' ? 'bad' : 'warn';
  const was = unset ? savedCurrent ?? null : savedCurrent ?? row.current;
  const keepLabel = was ? `Keep ${was}` : 'Not set';

  const choice = (o: Option) => (
    <div key={o.id} className="gy-radio">
      <label>
        <input type="radio" name={row.id} checked={picked === o.id} onChange={() => onPick(o.id)} />
        <span className="gy-radio-text">{o.label}{o.recommended && <span className="gy-muted gy-row-rec">Recommended</span>}</span>
        {o.recommended && row.aiPending && <Loader2 size={12} className="gy-spin" aria-hidden="true" />}
      </label>
      {o.link && onOpen && <button type="button" className="gy-row-link" aria-label={`Open ${o.linkLabel ?? o.label} in OWOX`} title={`Open ${o.linkLabel ?? o.label} in OWOX`} onClick={() => onOpen(o.link!)}><SquareArrowOutUpRight size={14} aria-hidden="true" /></button>}
    </div>
  );

  const radios = (() => {
    const shown = more ? ordered : ordered.slice(0, SHOWN);
    return (
      <div role="radiogroup" aria-label={row.title} className="gy-radios">
        <div className="gy-radio"><label><input type="radio" name={row.id} checked={picked === undefined} onChange={() => onPick(null)} /><span className="gy-radio-text">{keepLabel}</span></label></div>
        {shown.map(choice)}
        {!more && ordered.length > SHOWN && <button type="button" className="gy-link gy-row-more" onClick={() => setMore(true)}>{`Show ${ordered.length - SHOWN} more`}</button>}
      </div>
    );
  })();

  const dismissed = picked === 'dismiss';
  const extras = !readOnly && (
    <>
      {row.state !== 'done' && links.map((o) => <button key={o.id} type="button" className="gy-link gy-row-open" onClick={() => o.action.kind === 'open' && onOpen?.(o.action.path)}>{o.label}</button>)}
      {row.dismissable && !dismissed && row.state !== 'done' && <button type="button" className="gy-link" aria-label={`Dismiss ${row.title}`} onClick={() => onPick('dismiss')}>Dismiss</button>}
      {dismissed && <span className="gy-muted">Dismissed <button type="button" className="gy-link" aria-label={`Undo dismiss ${row.title}`} onClick={() => onPick(null)}>Undo</button></span>}
    </>
  );

  return (
    <div className="gy-row" data-row-id={row.id} data-severity={row.severity} data-state={row.state}>
      <span className="gy-row-icon" aria-hidden="true">{row.state === 'done' ? <Check size={14} /> : <span className="gy-row-dot" />}</span>
      <div className="gy-row-text">
        <div className="gy-hint-line"><strong>{row.title}</strong><HintButton title={row.title} id={hintId} open={hintOpen} onToggle={onHint} anchor={anchor} /></div>
        {row.detail && <span className="gy-row-detail" data-tone={detailTone}>{row.detail}</span>}
        <HintBubble id={hintId} open={hintOpen} anchor={anchor}>{`${row.question} ${row.why}`}</HintBubble>
      </div>
      <div className="gy-row-side">
        {readOnly || (!unset && !changing) ? (
          <>
            {row.current ? <span className="gy-row-value">{row.current}</span> : <span className="gy-muted">Not set</span>}
            {readOnly && row.state !== 'done' && rec && <span className="gy-muted">Recommended: {rec.label}</span>}
            {!readOnly && <button type="button" className="gy-link" aria-label={`Change ${row.title}`} onClick={() => setChanging(true)}>Change</button>}
          </>
        ) : radios}
        {row.state === 'error' && <button type="button" className="gy-link" onClick={onRetry}>Retry</button>}
        {extras}
      </div>
    </div>
  );
}
