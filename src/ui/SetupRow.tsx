import { Check, Loader2, Pencil, SquareArrowOutUpRight, Tags } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Option, Row } from '../setup/types';
import { FieldHelp } from './FieldHelp';
import { MartIcon } from './MartIcon';
import { OptionSearch } from './OptionSearch';

/** The context icon, as the context cell's label draws it. */
export const ContextIcon = ({ size = 16 }: { size?: number }) => <span className="gy-setup-group-icon" aria-hidden="true"><Tags size={size} aria-hidden="true" /></span>;

const SHOWN = 3;
/** A list of this many options or more gets a search field instead of "Show N more". */
export const SEARCH_AT = 12;
const SHOWN_MULTI = 6;

export interface SetupRowProps {
  row: Row; readOnly: boolean; saving?: boolean;
  /** The staged option for this row, if any. */
  picked?: string;
  /** The row had no saved value: it shows the radio list. */
  unset: boolean;
  /** The row as its staged pick ran against it: options and value stay put while later picks change the draft. */
  optionRow?: Row;
  /** Counts successful saves: an open edit closes when it goes up. */
  saveCount?: number;
  /** Data Mart id to its icon, for the options that point at a Data Mart. */
  martIcons?: Record<string, string | null>;
  /** The row sits in a context cell: its title drops the context name and is not bold. */
  inCell?: boolean;
  onPick: (optionId: string | null) => void; onRetry: () => void; onOpen?: (path: string) => void;
}

/** One setup question: the value now, and for an unanswered row (or on edit) a radio list of the ways to answer it. */
export function SetupRow({ row, readOnly, saving = false, picked, unset, optionRow, saveCount = 0, martIcons, inCell = false, onPick, onRetry, onOpen }: SetupRowProps) {
  const [changing, setChanging] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { setChanging(false); }, [saveCount]);
  const rowRef = useRef<HTMLDivElement>(null);
  // the edit pencil opens the list with its first radio or checkbox focused
  useEffect(() => { if (changing) rowRef.current?.querySelector<HTMLElement>('input[type="radio"], input[type="checkbox"]')?.focus(); }, [changing]);
  const uid = useId();
  const src = optionRow ?? row;
  const was = unset ? src.current : src.current ?? row.current;
  // the shape of the radio list comes from the row the pick ran against, not the live draft
  const dismissed = !unset && src.dismissed === true;
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
  const hasRadios = choices.length > 0 || dismissed || !!src.multi;

  const moreOf = (link?: string) => (link && onOpen ? () => onOpen(link) : undefined);
  const linkBtn = (o: Pick<Option, 'link' | 'linkLabel' | 'label'>) => o.link && onOpen && <button type="button" className="gy-row-link gy-row-link-reveal" aria-label={`Open ${o.linkLabel ?? o.label} in OWOX`} title={`Open ${o.linkLabel ?? o.label} in OWOX`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(o.link!); }}><SquareArrowOutUpRight size={14} aria-hidden="true" /></button>;
  // an option without a Data Mart ("Not set", "No plan yet") has no icon slot: its label starts right after the radio
  const martIcon = (o?: { martId?: string }) => o?.martId && <MartIcon icon={martIcons?.[o.martId] ?? null} size={14} className="gy-opt-icon" aria-hidden="true" />;
  const itemIcon = (i: { martId?: string; icon?: 'mart' | 'context' }) => (i.icon === 'context' ? <Tags size={14} className="gy-opt-icon" aria-hidden="true" /> : martIcon(i));
  // the last word and its (?) stay together; the pill follows inline, and the link icon after it takes no line width (see .gy-radio .gy-row-link)
  let seq = 0;
  const radio = (key: string, label: ReactNode, checked: boolean, onChange: () => void, o?: Option, disabled = false, martId = o?.martId) => {
    const nid = `${uid}-n${seq++}`;
    const text = typeof label === 'string' ? label : null;
    const cut = text ? text.search(/\s\S*$/) : -1;
    const head = text && cut > 0 ? text.slice(0, cut + 1) : '';
    const tail = text ? text.slice(head.length) : label;
    return (
      <div key={key} className="gy-radio">
        <input id={`${uid}-${key}`} aria-labelledby={`${nid}-h ${nid}-w${o?.recommended ? ` ${nid}-r` : ''}`} type="radio" name={row.id} checked={checked} disabled={saving || disabled} onChange={onChange} />
        <label htmlFor={`${uid}-${key}`}>{martIcon({ martId })}<span className="gy-radio-text"><span id={`${nid}-h`}>{head}</span><span className="gy-radio-tail"><span id={`${nid}-w`} className="gy-radio-word">{tail}</span>{o?.description && <FieldHelp label={o.label} description={o.description} onMore={moreOf(o.link)} />}</span>{o?.recommended && <span id={`${nid}-r`} className="gy-row-rec">Recommended</span>}{o && linkBtn(o)}{o?.recommended && row.aiPending && <Loader2 size={12} className="gy-spin" aria-hidden="true" />}</span></label>
      </div>
    );
  };

  // a multi-pick row: one checkbox per field, up to `max` checked; the staged set rides in the pick's option id
  const multi = src.multi;
  const checks = (() => {
    if (!multi) return null;
    const live = row.multi?.checked ?? multi.checked;
    const full = multi.max !== undefined && live.length >= multi.max;
    // the saved set is no pick: checking back to it (an empty set on a dismissed row included) clears the staged one
    const send = (paths: string[]) => onPick(paths.length === multi.checked.length && paths.every((p) => multi.checked.includes(p)) ? null : `set:${JSON.stringify(paths)}`);
    const toggle = (path: string, on: boolean) => send(multi.items.filter((i) => (i.path === path ? on : live.includes(i.path))).map((i) => i.path));
    // a long list shows the top boxes and every checked one; a search adds the rest
    const long = multi.items.length >= SEARCH_AT;
    const list = long ? multi.items.filter((i, n) => n < SHOWN_MULTI || live.includes(i.path)) : multi.items;
    const rest = multi.items.filter((i) => !list.includes(i));
    // the options a checkbox row keeps as links under its boxes: the one that declines, and the one that creates contexts
    const extra = src.options.filter((o) => o.declines || o.action.kind === 'teams');
    const item = (i: (typeof list)[number]) => {
      const cid = `${uid}-c-${i.path}`, lid = `${uid}-c${list.indexOf(i)}`;
      const on = live.includes(i.path);
      const text = i.label;
      return (
        <div key={i.path} className="gy-radio gy-check">
          <input id={cid} type="checkbox" aria-labelledby={`${lid}-w${i.recommended ? ` ${lid}-r` : ''}`} checked={on} disabled={saving || (full && !on)} onChange={(e) => toggle(i.path, e.target.checked)} />
          <label htmlFor={cid}>{itemIcon(i)}<span className="gy-radio-text"><span className="gy-radio-tail"><span id={`${lid}-w`} className="gy-radio-word">{text}</span>{i.description && <FieldHelp label={text} description={i.description} onMore={moreOf(i.link)} />}</span>{i.recommended && <span id={`${lid}-r`} className="gy-row-rec">Recommended</span>}{linkBtn({ link: i.link, linkLabel: i.linkLabel, label: text })}</span></label>
        </div>
      );
    };
    return (
      <>
        <div role="group" aria-label={row.title} className="gy-radios">
          {list.map(item)}
        </div>
        {long && rest.length > 0 && !readOnly && <OptionSearch options={rest.map((i) => ({ id: i.path, label: i.label, recommended: false, action: { kind: 'set', next: (s) => s }, ...(i.martId ? { martId: i.martId } : {}), ...(i.description ? { description: i.description } : {}) }))} label={`Search ${row.title}`} disabled={saving || full} icon={(o) => martIcon(o) || null} onPick={(o) => toggle(o.id, true)} />}
        {full && <span className="gy-muted gy-row-note">{`Up to ${multi.max}: uncheck one to pick another`}</span>}
        {!readOnly && (changing || picked !== undefined) && <button type="button" className="gy-link gy-row-open" disabled={saving} onClick={() => { onPick(null); setChanging(false); }}>Cancel</button>}
        {extra.map((o) => (picked === o.id || (o.declines && picked === undefined && dismissed) ? <span key={o.id} className="gy-muted gy-row-note">{o.label}</span> : <button key={o.id} type="button" className="gy-link gy-row-open" disabled={saving} onClick={() => onPick(o.id)}>{o.label}</button>))}
      </>
    );
  })();

  // a notice can be waved off; a row with its own "no" option already has that answer
  const offerDismiss = src.dismissable && !implicit && !dismissed && !choices.some((o) => o.declines);
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
    const search = !readOnly && !more && ordered.length >= SEARCH_AT;
    const remaining = ordered.filter((o) => !list.includes(o));
    return (
      <>
        <div role="radiogroup" aria-label={row.title} className="gy-radios">
          {implicit
            ? (match ? null : radio('implicit', row.current, true, () => {}, undefined, true))
            : radio('keep', keepOpt ? keepOpt.label : keepLabel, picked === undefined, () => onPick(null), keepOpt ?? (dup?.recommended ? dup : undefined), false, keepOpt?.martId ?? dup?.martId ?? (was && !dismissed ? src.currentMartId : undefined))}
          {dismissed && radio('undismiss', 'Not set', picked === 'undismiss', () => onPick('undismiss'))}
          {list.map((o) => radio(o.id, o.label, picked === o.id || match?.id === o.id, () => onPick(o.id), o))}
          {offerDismiss && radio('dismiss', 'Not needed', picked === 'dismiss', () => onPick('dismiss'))}
        </div>
        {search && hidden > 0 && <OptionSearch options={remaining} label={`Search ${row.title}`} disabled={saving} icon={(o) => martIcon(o) || null} onPick={(o) => onPick(o.id)} />}
        {!search && !more && hidden > 0 && <button type="button" className="gy-link gy-row-more" onClick={() => setMore(true)}>{`Show ${hidden} more`}</button>}
        {implicit && <span className="gy-muted gy-row-note">Set by your choice above</span>}
      </>
    );
  })();

  const extras = !readOnly && (
    <>
      {(row.state !== 'done' || linkOnly || (dismissed && changing)) && links.map((o) => <button key={o.id} type="button" className="gy-link gy-row-open" onClick={() => o.action.kind === 'open' && onOpen?.(o.action.path)}>{o.label}</button>)}
    </>
  );

  return (
    <div className="gy-row" ref={rowRef} data-row-id={row.id} data-severity={row.severity} data-state={row.state}>
      <span className="gy-row-icon" aria-hidden="true">{row.state === 'done' ? <Check size={14} /> : <span className="gy-row-dot" />}</span>
      <div className="gy-row-title">{inCell ? <span className="gy-row-title-plain">{row.group && row.title.startsWith(`${row.group} `) ? row.title.slice(row.group.length + 1) : row.title}</span> : <strong>{row.title}</strong>}<FieldHelp label={row.title} description={`${row.question} ${row.why}`} /></div>
      {row.detail && <div className="gy-row-text"><span className="gy-row-detail" data-tone={detailTone}>{row.detail}</span></div>}
      <div className="gy-row-side">
        {linkOnly ? dismissOnly : readOnly || !hasRadios || (!unset && !changing) ? (
          <>
            <span className="gy-row-valueline">
              {row.current ? <>{row.currentMartId && <MartIcon icon={martIcons?.[row.currentMartId] ?? null} size={14} className="gy-opt-icon gy-value-icon" aria-hidden="true" />}<span className="gy-row-value">{row.currentList ? <span className="gy-ctx-list">{row.currentList.map((n) => <span key={n} className="gy-ctx-item"><ContextIcon size={12} />{n}</span>)}</span> : row.current}{row.currentDescription && <span aria-hidden="true">{'\u2060'}</span>}<FieldHelp label={row.current} description={row.currentDescription} /></span></> : <span className="gy-muted">Not set</span>}
              {!readOnly && hasRadios && <button type="button" className="gy-row-link gy-row-link-reveal" aria-label={`Edit ${row.title}`} title="Edit" onClick={() => setChanging(true)}><Pencil size={14} aria-hidden="true" /></button>}
            </span>
            {readOnly && row.state !== 'done' && rec && <span className="gy-muted gy-row-recline">Recommended: {martIcon(rec)}{rec.label}<FieldHelp label={rec.label} description={rec.description} onMore={moreOf(rec.link)} />{linkBtn(rec)}</span>}
          </>
        ) : checks ?? radios}
        {row.state === 'error' && <button type="button" className="gy-link" onClick={onRetry}>Retry</button>}
        {extras}
      </div>
    </div>
  );
}
