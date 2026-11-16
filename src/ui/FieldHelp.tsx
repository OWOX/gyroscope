import { CircleHelp } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;

/** A (?) after a Data Mart field's label: hover or focus shows the field's schema description in a small tooltip. Nothing renders without one.
 *  The tooltip floats in the plugin root (fixed, above or below the (?), kept inside the viewport), so no collapsing block clips it. */
export function FieldHelp({ label, description }: { label: string; description?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => { const b = btn.current; setHost(b?.closest('.dm-page') ?? b?.closest('.gy-setup') ?? document.body); }, [description]);
  const show = () => { window.clearTimeout(timer.current); setOpen(true); };
  // a short grace so the pointer can cross the gap onto the tooltip, which stays open while hovered
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 80); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const reposition = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    const t = tip.current;
    if (!r || !t) return;
    const w = t.offsetWidth, h = t.offsetHeight;
    const above = r.top - h - 4 >= MARGIN || r.top > window.innerHeight - r.bottom;
    const left = Math.max(MARGIN, Math.min(r.left - 8, window.innerWidth - w - MARGIN));
    setPlace({ left, top: above ? Math.max(MARGIN, r.top - h - 4) : r.bottom + 4 });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [open, reposition]);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); window.clearTimeout(timer.current); setOpen(false); } };
  if (!description) return null;
  return (
    <span className="gy-fieldtip">
      <button ref={btn} type="button" className="gy-fieldtip-btn" aria-label={`About ${label}`} aria-describedby={id}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={onKey}><CircleHelp size={12} aria-hidden="true" /></button>
      {host && createPortal(
        <span ref={tip} id={id} role="tooltip" className="gy-fieldtip-body" data-open={open} style={place} onMouseEnter={show} onMouseLeave={hide}>{description}</span>,
        host,
      )}
    </span>
  );
}
