import { useEffect, useRef, type KeyboardEvent } from 'react';

/** An in-page confirm: the sandbox has no allow-modals, so window.confirm is out. Escape and Stay keep the page as it is. */
export function LeaveDialog({ changes, save = false, onStay, onLeave }: { changes: number; save?: boolean; onStay: () => void; onLeave: () => void }) {
  const stay = useRef<HTMLButtonElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    stay.current?.focus();
    // the page behind is out of the tab order and the accessibility tree while the dialog is open
    const behind = [...(backdrop.current?.parentElement?.children ?? [])].filter((el) => el !== backdrop.current && !el.hasAttribute('inert'));
    behind.forEach((el) => el.setAttribute('inert', ''));
    return () => { behind.forEach((el) => el.removeAttribute('inert')); if (from?.isConnected) from.focus(); };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onStay(); return; }
    if (e.key !== 'Tab') return;
    // two buttons: the trap is a swap at either end
    // whatever has focus (even none), Tab lands on one of the two
    const at = document.activeElement;
    const to = e.shiftKey ? (at === stay.current ? leave.current : stay.current) : (at === leave.current ? stay.current : leave.current);
    e.preventDefault();
    to?.focus();
  };
  return (
    <div className="gy-modal-backdrop" ref={backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onStay(); }}>
      <div className="gy-modal" role="alertdialog" aria-modal="true" aria-labelledby="gy-leave-title" aria-describedby="gy-leave-desc" onKeyDown={onKey} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
        <h2 id="gy-leave-title" className="gy-modal-title">{save ? 'Discard Setup changes?' : 'Leave without saving?'}</h2>
        <p id="gy-leave-desc" className="gy-modal-text">You have {changes} unsaved {changes === 1 ? 'change' : 'changes'} in Setup.{save && ' Saving General settings drops them.'}</p>
        <div className="gy-modal-actions">
          <button type="button" className="gy-btn" ref={leave} onClick={onLeave}>{save ? 'Discard Setup changes' : 'Leave without saving'}</button>
          <button type="button" className="gy-btn gy-btn-primary" ref={stay} onClick={onStay}>Stay</button>
        </div>
      </div>
    </div>
  );
}
