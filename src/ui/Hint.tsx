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

/** A bordered bubble whose top-edge caret points at the (?) button: `--caret-x` is the button's centre from the bubble's left edge. */
export function HintBubble({ id, open, anchor, className, children }: { id: string; open: boolean; anchor: RefObject<HTMLButtonElement | null>; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current, b = ref.current;
      if (a && b) b.style.setProperty('--caret-x', `${a.getBoundingClientRect().left - b.getBoundingClientRect().left + a.offsetWidth / 2}px`);
    };
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor]);
  return <div ref={ref} id={id} className={`gy-hint${className ? ` ${className}` : ''}`} hidden={!open}>{children}</div>;
}
