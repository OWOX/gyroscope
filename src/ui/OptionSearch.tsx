import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Option } from '../setup/types';
import { FieldHelp } from './FieldHelp';

export const MAX_MATCHES = 8;

const LIST_REM = 16;
const GAP = 4;
const EDGE = 8;

/** A search field over a long list of options: a combobox with at most 8 matches in a dropdown. Picking calls `onPick` and clears the field. */
export function OptionSearch({ options, label, disabled, icon, onPick }: { options: Option[]; label: string; disabled?: boolean; icon: (o: Option) => ReactNode; onPick: (o: Option) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // the dropdown floats in the plugin root, so no collapsing block clips it or grows around it
  const [host, setHost] = useState<Element | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => { const w = wrap.current; setHost(w?.closest('.dm-page') ?? w?.closest('.gy-setup') ?? document.body); }, []);
  const needle = q.trim().toLowerCase();
  const matches = (needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options).slice(0, MAX_MATCHES);
  const shown = open && !disabled && matches.length > 0;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const empty = open && !disabled && needle !== '' && matches.length === 0;
  const visible = shown || empty;
  // below the field, or above it when the viewport leaves less than the list's height underneath; the list never outgrows the room on its side
  const last = useRef('');
  const reposition = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const need = LIST_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    const below = window.innerHeight - r.bottom, above = r.top;
    const up = below < need && above > below;
    const maxHeight = Math.max(0, Math.min(need, (up ? above : below) - GAP - EDGE));
    const key = [r.left, r.width, up ? 'u' : 'd', up ? r.top : r.bottom, maxHeight].join('|');
    if (key === last.current) return;
    last.current = key;
    setPlace({ left: r.left, width: r.width, maxHeight, ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }) });
  }, []);
  useLayoutEffect(() => {
    if (!visible) return;
    last.current = '';
    reposition();
    // any layout change while open (a hint folding, a block resizing) moves the field: follow it every frame
    let raf = requestAnimationFrame(function tick() { reposition(); raf = requestAnimationFrame(tick); });
    const away = (e: MouseEvent) => { const t = e.target as Element; if (!wrap.current?.contains(t) && !pop.current?.contains(t) && !t.closest?.('.gy-fieldtip-body')) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('mousedown', away); };
  }, [visible, reposition]);
  const pick = (o: Option) => { if (disabled) return; onPick(o); setQ(''); setOpen(false); setActive(0); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % Math.max(matches.length, 1));
    } else if (e.key === 'Enter') {
      if (shown && matches[active]) { e.preventDefault(); pick(matches[active]!); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    }
  };
  return (
    <div className="gy-opt-search" ref={wrap}>
      <input
        type="text" className="gy-opt-search-input" role="combobox" aria-label={label} aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined} autoComplete="off" disabled={disabled}
        placeholder={`Search ${options.length} more…`} value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey}
      />
      {host && createPortal(
        <div ref={pop} className="gy-opt-search-pop" style={place} hidden={!visible} onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={label} className="gy-opt-search-list" hidden={!shown}>
            {matches.map((o, i) => (
              <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-describedby={o.description ? `${listId}-${i}-d` : undefined} className="gy-opt-search-item" onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); if ((e.target as Element).closest('.gy-fieldtip, .gy-fieldtip-body')) return; pick(o); }}>
                {icon(o)}<span className="gy-opt-search-label">{o.label}</span><FieldHelp label={o.label} description={o.description} tabStop={false} />{o.description && <span id={`${listId}-${i}-d`} className="gy-sr">{o.description}</span>}
              </li>
            ))}
          </ul>
          {empty && <div className="gy-opt-search-empty gy-muted" role="status">No matches</div>}
        </div>,
        host,
      )}
    </div>
  );
}
