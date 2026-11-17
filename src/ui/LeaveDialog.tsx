import { useEffect, useRef, type KeyboardEvent } from 'react';

/** An in-page confirm: the sandbox has no allow-modals, so window.confirm is out. Escape and Stay keep the page as it is. */
export function LeaveDialog({ changes, onStay, onLeave }: { changes: number; onStay: () => void; onLeave: () => void }) {
  const stay = useRef<HTMLButtonElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    stay.current?.focus();
    return () => { if (from?.isConnected) from.focus(); };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onStay(); return; }
    if (e.key !== 'Tab') return;
    // two buttons: the trap is a swap at either end
    const to = e.shiftKey ? (document.activeElement === stay.current ? leave.current : stay.current) : (document.activeElement === leave.current ? stay.current : leave.current);
    e.preventDefault();
    to?.focus();
  };
  return (
    <div className="gy-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onStay(); }}>
      <div className="gy-modal" role="alertdialog" aria-modal="true" aria-labelledby="gy-leave-title" aria-describedby="gy-leave-desc" onKeyDown={onKey}>
        <h2 id="gy-leave-title" className="gy-modal-title">Leave without saving?</h2>
        <p id="gy-leave-desc" className="gy-modal-text">You have {changes} unsaved {changes === 1 ? 'change' : 'changes'} in Setup.</p>
        <div className="gy-modal-actions">
          <button type="button" className="gy-btn" ref={leave} onClick={onLeave}>Leave without saving</button>
          <button type="button" className="gy-btn gy-btn-primary" ref={stay} onClick={onStay}>Stay</button>
        </div>
      </div>
    </div>
  );
}
