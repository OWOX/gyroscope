import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { useBelow } from './anchor';

export interface SelectOption { value: string; label: string; disabled?: boolean; keywords?: string[] }

/**
 * A combobox with native-style typeahead by default. With a search placeholder, typing filters the list by label
 * and keywords and Enter selects the highlighted result. The current value is on `data-value`.
 */
export function Select({ label, value, options: allOptions, className = '', invalid, describedBy, title, onChange, searchPlaceholder }: {
  label: string; value: string; options: SelectOption[]; className?: string;
  invalid?: boolean; describedBy?: string; title?: string; searchPlaceholder?: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // the highlighted option by value, so it stays put while the options change under an open list
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const style = useBelow(anchor, open);
  // only for the keyboard: scrolling under a hovering pointer would move the next option beneath it
  const byKeys = useRef(false);
  const optId = (i: number) => `${id}-o${i}`;
  const current = allOptions.find((o) => o.value === value);
  const term = query.trim().toLowerCase();
  const options = term ? allOptions.filter((o) =>
    o.label.toLowerCase().includes(term) || o.keywords?.some((word) => word.toLowerCase().includes(term))) : allOptions;
  const enabled = (i: number) => !!options[i] && !options[i]!.disabled;
  const at = options.findIndex((o) => o.value === activeValue);
  const active = enabled(at) ? at : term ? options.findIndex((o) => !o.disabled) : -1;
  const selected = options.findIndex((o) => o.value === value);
  useEffect(() => { if (open && active >= 0 && byKeys.current) document.getElementById(`${id}-o${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active, id]);

  const show = () => { byKeys.current = true; setOpen(true); setActiveValue(enabled(selected) ? value : null); };
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (i: number) => { const o = options[i]; if (o && !o.disabled) { if (o.value !== value) onChange(o.value); close(); } };
  // the next enabled option from `from` in direction `d`, or `from` when there is none
  const seek = (from: number, d: number) => { for (let i = from + d; i >= 0 && i < options.length; i += d) if (enabled(i)) return i; return from; };
  const step = (i: number) => { if (!enabled(i)) return; byKeys.current = true; setActiveValue(options[i]!.value); };
  // the next enabled option after `from` whose label starts with `k`, wrapping; -1 when there is none
  const typed = (from: number, k: string) => {
    const n = options.length;
    for (let j = 1; j <= n; j++) { const i = (((from + j) % n) + n) % n; if (enabled(i) && options[i]!.label.toLowerCase().startsWith(k)) return i; }
    return -1;
  };
  // with the list closed the keys change the value itself, as a native select's do
  const move = (i: number) => { if (open) step(i); else if (i >= 0 && i !== selected) onChange(options[i]!.value); };
  const filter = (text: string) => { byKeys.current = true; setActiveValue(null); setQuery(text); };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) show();
      // with nothing highlighted, Down starts at the first option and Up at the last
      else if (active < 0) step(e.key === 'ArrowDown' ? seek(-1, 1) : seek(options.length, -1));
      else step(seek(active, e.key === 'ArrowDown' ? 1 : -1));
    } else if (!searchPlaceholder && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      const i = e.key === 'Home' ? seek(-1, 1) : seek(options.length, -1);
      move(enabled(i) ? i : -1);
    } else if (e.key === 'Enter' || (e.key === ' ' && (!searchPlaceholder || !open))) {
      e.preventDefault();
      if (!open) show();
      else if (active >= 0) pick(active);
      else close();
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); close(); }
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!searchPlaceholder) move(typed(open ? active : selected, e.key.toLowerCase()));
      else if (!open) { e.preventDefault(); show(); filter(e.key); }
    }
  };
  const control = {
    role: 'combobox', 'aria-label': label, 'aria-haspopup': 'listbox' as const, 'aria-expanded': open,
    'aria-controls': open ? `${id}-list` : undefined, 'aria-activedescendant': open && active >= 0 ? optId(active) : undefined,
    'aria-invalid': invalid || undefined, 'aria-describedby': describedBy, title, 'data-value': value,
    onBlur: close, onKeyDown,
  };
  const triggerClass = `gy-input gy-pick ${className}`.trim();
  const chevron = <ChevronDown size={14} aria-hidden="true" className="gy-pick-chev" />;

  return (
    <>
      {searchPlaceholder ? (
        <div ref={anchor} className={`${triggerClass} gy-pick-search`}
          onMouseDown={(e) => { if (e.target !== searchInput.current) e.preventDefault(); }}
          onClick={(e) => {
            if (open && e.target === searchInput.current) return;
            searchInput.current?.focus();
            if (open) close(); else show();
          }}
        >
          <input {...control} ref={searchInput} className="gy-pick-text" type="text" aria-autocomplete="list"
            autoComplete="off" spellCheck={false} readOnly={!open} placeholder={searchPlaceholder}
            value={open ? query : current?.label ?? value} onChange={(e) => filter(e.target.value)} />
          {chevron}
        </div>
      ) : (
        <div {...control} ref={anchor} tabIndex={0} className={triggerClass} onClick={() => (open ? close() : show())}>
          <span className="gy-pick-text">{current?.label ?? value}</span>
          {chevron}
        </div>
      )}
      {open && (
        // mousedown would blur the combobox before the click lands
        <div id={`${id}-list`} role="listbox" aria-label={label} className="gy-combo-list gy-combo-flat" style={style} onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <div
              key={o.value} id={optId(i)} role="option" data-value={o.value} aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
              className={`gy-combo-opt${o.disabled ? ' gy-combo-off' : ''}${active === i ? ' gy-combo-active' : ''}`}
              onMouseEnter={() => { if (!o.disabled) { byKeys.current = false; setActiveValue(o.value); } }} onClick={() => pick(i)}
            >
              {o.label}
            </div>
          ))}
          {searchPlaceholder && options.length === 0 && <div role="status" className="gy-combo-empty">No matching options</div>}
        </div>
      )}
    </>
  );
}
