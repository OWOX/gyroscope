import { Check, Loader2, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Option, Row } from '../setup/types';
import { HintBubble, HintButton } from './Hint';

const SHOWN = 3;

export interface SetupRowProps {
  row: Row; readOnly: boolean; saving?: boolean;
  /** The staged option for this row, if any. */
  picked?: string;
  /** The row had no saved value: it shows the radio list. */
  unset: boolean;
  /** The row as its staged pick ran against it: options and value stay put while later picks change the draft. */
  optionRow?: Row;
  /** Counts successful saves: an open "Change" closes when it goes up. */
  saveCount?: number;
  hintOpen: boolean; onHint: () => void;
  onPick: (optionId: string | null) => void; onRetry: () => void; onOpen?: (path: string) => void;
}

/** One setup question: the value now, and for an unanswered row (or on "Change") a radio list of the ways to answer it. */
export function SetupRow({ row, readOnly, saving = false, picked, unset, optionRow, saveCount = 0, hintOpen, onHint, onPick, onRetry, onOpen }: SetupRowProps) {
  const [changing, setChanging] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { setChanging(false); }, [saveCount]);
  const anchor = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const uid = useId();
  const src = optionRow ?? row;
  const was = unset ? src.current : src.current ?? row.current;
  const dismissed = !unset && row.dismissed === true;
  // the option that equals the saved value is "Keep", not a second way to say it; only the first match is hidden
  const dup = unset || !was || dismissed ? undefined : src.options.find((o) => o.action.kind !== 'open' && o.label === was);
  // a dismissed row's "Not needed" is already its "no", so the options that decline are left out
  const choices = src.options.filter((o) => o.action.kind !== 'open' && o !== dup && !(dismissed && o.declines));
  const links = src.options.filter((o) => o.action.kind === 'open');
  // an option marked `keep` is the row's default; the rest list the recommended one first, in an order that doesn't move once picked
  const keepOpt = choices.find((o) => o.keep);
  const rest = choices.filter((o) => o !== keepOpt);
  const ordered = [...rest.filter((o) => o.recommended), ...rest.filter((o) => !o.recommended)];
  const rec = ordered.find((o) => o.recommended);
  const detailTone = row.state === 'error' || row.state === 'broken' || row.severity === 'error' ? 'bad' : 'warn';
  // a row another pick filled in: show the option that matches, and no "Not set"
  const implicit = unset && picked === undefined && row.state === 'done' && !!row.current;
  const match = implicit ? ordered.find((o) => o.label === row.current) : undefined;
  const keepLabel = dismissed ? was ?? 'Not needed' : was ? `Keep ${was}` : src.state === 'broken' || src.state === 'error' ? 'Keep the saved value' : 'Not set';
  const hasRadios = choices.length > 0 || dismissed;

  const linkBtn = (o: Option) => o.link && onOpen && <button type="button" className="gy-row-link gy-row-link-reveal" aria-label={`Open ${o.linkLabel ?? o.label} in OWOX`} title={`Open ${o.linkLabel ?? o.label} in OWOX`} onClick={() => onOpen(o.link!)}><SquareArrowOutUpRight size={14} aria-hidden="true" /></button>;
  const radio = (key: string, label: ReactNode, checked: boolean, onChange: () => void, o?: Option, disabled = false) => (
    <div key={key} className="gy-radio">
      <input id={`${uid}-${key}`} type="radio" name={row.id} checked={checked} disabled={saving || disabled} onChange={onChange} />
      <label htmlFor={`${uid}-${key}`}>{label}{o?.recommended && <span className="gy-row-rec">Recommended</span>}{o?.recommended && row.aiPending && <Loader2 size={12} className="gy-spin" aria-hidden="true" />}</label>
      {o && linkBtn(o)}
    </div>
  );

  // a notice can be waved off; a row with its own "no" option already has that answer
  const offerDismiss = row.dismissable && !implicit && !dismissed && !choices.some((o) => o.declines);
  // a notice with only links still gets its "Not needed"
  const linkOnly = !hasRadios && unset && !readOnly && offerDismiss;

  const dismissOnly = (
    <div role="radiogroup" aria-label={row.title} className="gy-radios">
      {radio('keep', 'Not set', picked === undefined, () => onPick(null))}
      {radio('dismiss', 'Not needed', picked === 'dismiss', () => onPick('dismiss'))}
    </div>
  );

  const radios = (() => {
    const shown = more ? ordered : ordered.slice(0, SHOWN);
    // the checked option always shows, even when it sits behind "Show more"
    const must = ordered.find((o) => o.id === picked) ?? match;
    const list = must && !shown.includes(must) ? [...shown, must] : shown;
    const hidden = ordered.length - list.length;
    return (
      <>
        <div role="radiogroup" aria-label={row.title} className="gy-radios">
          {implicit
            ? (match ? null : radio('implicit', row.current, true, () => {}, undefined, true))
            : radio('keep', keepOpt ? keepOpt.label : keepLabel, picked === undefined, () => onPick(null), keepOpt ?? (dup?.recommended ? dup : undefined))}
          {dismissed && radio('undismiss', 'Not set', picked === 'undismiss', () => onPick('undismiss'))}
          {list.map((o) => radio(o.id, o.label, picked === o.id || match?.id === o.id, () => onPick(o.id), o))}
          {offerDismiss && radio('dismiss', 'Not needed', picked === 'dismiss', () => onPick('dismiss'))}
        </div>
        {!more && hidden > 0 && <button type="button" className="gy-link gy-row-more" onClick={() => setMore(true)}>{`Show ${hidden} more`}</button>}
        {implicit && <span className="gy-muted gy-row-note">Set by your choice above</span>}
      </>
    );
  })();

  const extras = !readOnly && (
    <>
      {(row.state !== 'done' || linkOnly) && links.map((o) => <button key={o.id} type="button" className="gy-link gy-row-open" onClick={() => o.action.kind === 'open' && onOpen?.(o.action.path)}>{o.label}</button>)}
    </>
  );

  return (
    <div className="gy-row" data-row-id={row.id} data-severity={row.severity} data-state={row.state}>
      <span className="gy-row-icon" aria-hidden="true">{row.state === 'done' ? <Check size={14} /> : <span className="gy-row-dot" />}</span>
      <div className="gy-row-text">
        <div className="gy-hintbox-line"><strong>{row.title}</strong><HintButton title={row.title} id={hintId} open={hintOpen} onToggle={onHint} anchor={anchor} /></div>
        {row.detail && <span className="gy-row-detail" data-tone={detailTone}>{row.detail}</span>}
        <HintBubble id={hintId} open={hintOpen} anchor={anchor}>{`${row.question} ${row.why}`}</HintBubble>
      </div>
      <div className="gy-row-side">
        {linkOnly ? dismissOnly : readOnly || !hasRadios || (!unset && !changing) ? (
          <>
            {row.current ? <span className="gy-row-value">{row.current}</span> : <span className="gy-muted">Not set</span>}
            {readOnly && row.state !== 'done' && rec && <span className="gy-muted gy-row-recline">Recommended: {rec.label}{linkBtn(rec)}</span>}
            {!readOnly && hasRadios && <button type="button" className="gy-link" aria-label={`Change ${row.title}`} onClick={() => setChanging(true)}>Change</button>}
          </>
        ) : radios}
        {row.state === 'error' && <button type="button" className="gy-link" onClick={onRetry}>Retry</button>}
        {extras}
      </div>
    </div>
  );
}
