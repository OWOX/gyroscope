import { CircleHelp } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownText } from './MarkdownText';

const MARGIN = 8;

const hostOf = (b: Element | null) => b?.closest('.dm-page') ?? b?.closest('.gy-setup') ?? document.body;

/**
 * The one (?) of the Setup tab: it shows only while its label is hovered or focused (see styles), and a click or Enter opens a dark tooltip with the Markdown `description`.
 * A second click, Escape or a click elsewhere closes it; nothing is open by default.
 * The tooltip floats in the plugin root (fixed, above or below the (?), kept inside the viewport), so it never moves content and no collapsing block clips it.
 * With `onMore`, long text is clamped to about 8 lines and a "Show more" link under it calls it; without, long text scrolls.
 */
export function FieldHelp({ label, description, onMore, tabStop = true }: { label: string; description?: string | null; onMore?: () => void; tabStop?: boolean }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const [clipped, setClipped] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // the (?) sits inside its option's label or a summary: a click on it must not pick the option or fold the group (native listener, so it runs before theirs)
  useEffect(() => { const b = btn.current; const stop = (e: Event) => e.preventDefault(); b?.addEventListener('click', stop); return () => b?.removeEventListener('click', stop); }, [description]);
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
    const b = body.current;
    if (onMore && b) setClipped(b.scrollHeight > b.clientHeight + 1);
    reposition();
  }, [open, clipped, reposition, onMore]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !tip.current?.contains(t)) close(); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (tip.current?.contains(document.activeElement)) btn.current?.focus(); close(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [open, close, reposition]);
  // the tooltip sits at the end of the page, so Tab from the (?) steps into it, and Tab inside it leaves it again
  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.shiftKey || !open) return;
    const first = tip.current?.querySelector<HTMLElement>('a, button');
    if (first) { e.preventDefault(); first.focus(); }
  };
  const onTipKey = (e: KeyboardEvent) => { if (e.key === 'Tab') { btn.current?.focus(); close(); } };
  if (!description) return null;
  return (
    <span className="gy-fieldtip">
      <button ref={btn} type="button" className="gy-fieldtip-btn" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} tabIndex={tabStop ? undefined : -1}
        onClick={(e) => { e.stopPropagation(); if (!open) setHost(hostOf(btn.current)); setOpen((o) => !o); }} onKeyDown={onBtnKey}><CircleHelp size={12} aria-hidden="true" /></button>
      {open && host && createPortal(
        <div ref={tip} id={id} role="tooltip" className="gy-fieldtip-body" style={place} onClick={(e) => e.stopPropagation()} onKeyDown={onTipKey}>
          <div ref={body} className="gy-tip-content" data-clamp={onMore ? true : undefined}><MarkdownText text={description} /></div>
          {onMore && clipped && <button type="button" className="gy-tip-more" onClick={() => { close(); onMore(); }}>Show more</button>}
        </div>,
        host,
      )}
    </span>
  );
}
