import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Option } from '../setup/types';

export const MAX_MATCHES = 8;

/** A search field over a long list of options: a combobox with at most 8 matches in a dropdown. Picking calls `onPick` and clears the field. */
export function OptionSearch({ options, label, disabled, icon, onPick }: { options: Option[]; label: string; disabled?: boolean; icon: (o: Option) => ReactNode; onPick: (o: Option) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const needle = q.trim().toLowerCase();
  const matches = (needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options).slice(0, MAX_MATCHES);
  const shown = open && !disabled && matches.length > 0;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const empty = open && !disabled && needle !== '' && matches.length === 0;
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
    <div className="gy-opt-search">
      <input
        type="text" className="gy-opt-search-input" role="combobox" aria-label={label} aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined} autoComplete="off" disabled={disabled}
        placeholder={`Search ${options.length} more…`} value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey}
      />
      <ul id={listId} role="listbox" aria-label={label} className="gy-opt-search-list" hidden={!shown}>
        {matches.map((o, i) => (
          <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="gy-opt-search-item" onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
            {icon(o)}<span>{o.label}</span>
          </li>
        ))}
      </ul>
      {empty && <div className="gy-opt-search-empty gy-muted" role="status">No matches</div>}
    </div>
  );
}
