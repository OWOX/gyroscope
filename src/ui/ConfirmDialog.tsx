import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export function ConfirmDialog({ title, description, cancelLabel, confirmLabel, onCancel, onConfirm }: {
  title: string;
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const behind = [...(backdrop.current?.parentElement?.children ?? [])].filter((el) => el !== backdrop.current && !el.hasAttribute('inert'));
    behind.forEach((el) => el.setAttribute('inert', ''));
    return () => {
      behind.forEach((el) => el.removeAttribute('inert'));
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const active = document.activeElement;
    const next = event.shiftKey
      ? (active === cancel.current ? confirm.current : cancel.current)
      : (active === confirm.current ? cancel.current : confirm.current);
    event.preventDefault();
    next?.focus();
  };

  return (
    <div className="gy-modal-backdrop" ref={backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="gy-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={onKeyDown} onMouseDown={(event) => { if (!(event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
        <h2 id={titleId} className="gy-modal-title">{title}</h2>
        <p id={descriptionId} className="gy-modal-text">{description}</p>
        <div className="gy-modal-actions">
          <button type="button" className="gy-btn" ref={confirm} onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" className="gy-btn gy-btn-primary" ref={cancel} onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}
