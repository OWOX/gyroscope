import { CircleHelp } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/** The (?) button that toggles a hint bubble. */
export function HintButton({ title, id, open, onToggle, anchor }: { title: string; id: string; open: boolean; onToggle: () => void; anchor: RefObject<HTMLButtonElement | null> }) {
  return (
    <button ref={anchor} type="button" className="gy-hint-btn" aria-expanded={open} aria-controls={id} aria-label={`About ${title}`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <CircleHelp size={14} aria-hidden="true" />
    </button>
  );
}

/** How far the caret's tip rises above the bubble's border box: the 8px square, rotated 45deg, sits 6px above it (top -5px from the padding edge plus the 1px border), so its centre is 2px above and its corner a half-diagonal further. */
const CARET_TIP = 2 + 4 * Math.SQRT2;

/** A bordered bubble whose top-edge caret points at the (?) button: `--caret-x` is the button's centre from the bubble's left edge. */
export function HintBubble({ id, open, anchor, className, children }: { id: string; open: boolean; anchor: RefObject<HTMLButtonElement | null>; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current, b = ref.current;
      if (!a || !b) return;
      b.style.setProperty('--caret-x', `${a.getBoundingClientRect().left - b.getBoundingClientRect().left + a.offsetWidth / 2}px`);
      // the caret's tip meets the (?) svg's bottom edge: slide the bubble by the measured gap less the tip's height above the bubble's border box
      const icon = a.querySelector('svg')?.getBoundingClientRect();
      const gap = icon ? b.getBoundingClientRect().top - icon.bottom - CARET_TIP : NaN;
      if (Number.isFinite(gap) && icon && icon.height > 0) b.style.marginTop = `${(parseFloat(getComputedStyle(b).marginTop) || 0) - gap}px`;
    };
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    // the bubble gains its size when its block unfolds or its text rewraps
    const watch = typeof ResizeObserver === 'undefined' || !ref.current ? null : new ResizeObserver(place);
    watch?.observe(ref.current!);
    return () => { window.removeEventListener('resize', place); watch?.disconnect(); };
  }, [open, anchor]);
  return <div ref={ref} id={id} className={`gy-hint${className ? ` ${className}` : ''}`} hidden={!open}>{children}</div>;
}
