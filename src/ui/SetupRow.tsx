import { Check, Loader2, Sparkles, SquareArrowOutUpRight } from 'lucide-react';
import type { Row } from '../setup/types';
import { Select } from './Select';

/** One setup question: what it is now, what is recommended, and the ways to change it. */
export function SetupRow({ row, readOnly, busy, onChoose, onDismiss, onRetry, onOpen }: {
  row: Row; readOnly: boolean; busy: boolean; onChoose: (optionId: string) => void; onDismiss: () => void; onRetry: () => void; onOpen: (path: string) => void;
}) {
  const rec = row.options.find((o) => o.recommended);
  // a finished row offers a change only when it is a settings change, not an append, a page or a no-op keep
  const showChip = !!rec && rec.label !== row.current && (row.state !== 'done' || (rec.action.kind === 'set' && !rec.keep));
  const options = row.options.map((o) => ({ value: o.id, label: o.recommended ? `${o.label} (Recommended)` : o.label }));
  const lead = row.aiPending ? <Loader2 size={12} className="gy-spin" aria-hidden="true" /> : row.aiPicked ? <Sparkles size={12} aria-hidden="true" /> : null;
  const detailTone = row.state === 'error' || row.severity === 'error' ? 'bad' : 'warn';
  return (
    <div className="gy-row" data-row-id={row.id} data-severity={row.severity} data-state={row.state}>
      <span className="gy-row-icon" aria-hidden="true">{row.state === 'done' ? <Check size={14} /> : <span className="gy-row-dot" />}</span>
      <div className="gy-row-text">
        <strong>{row.title}</strong>
        <span className="gy-muted gy-row-q">{row.question}</span>
        <span className="gy-muted gy-row-why">{row.why}</span>
        {row.detail && <span className="gy-row-detail" data-tone={detailTone}>{row.detail}</span>}
      </div>
      <div className="gy-row-side">
        {row.current ? <span className="gy-row-value">{row.current}</span> : <span className="gy-muted">Not set</span>}
        {showChip && rec && (
          <div className="gy-row-suggest">
            {readOnly
              ? <span className="gy-chip gy-row-chip" title={rec.label}>{lead} <span className="gy-row-chip-label">{rec.label}</span></span>
              : (
                <button type="button" className="gy-chip gy-row-chip" title={rec.label} aria-label={`Accept ${rec.label}`} disabled={busy} onClick={() => onChoose(rec.id)}>
                  {lead} <span className="gy-row-chip-label">{rec.label}</span> <span className="gy-row-accept">Accept</span>
                </button>
              )}
            {rec.link && <button type="button" className="gy-row-link" aria-label={`Open ${rec.label} in OWOX`} title={`Open ${rec.label} in OWOX`} onClick={() => onOpen(rec.link!)}><SquareArrowOutUpRight size={14} aria-hidden="true" /></button>}
          </div>
        )}
        {row.state === 'error' && <button type="button" className="gy-link" onClick={onRetry}>Retry</button>}
        {!readOnly && (
          <div className="gy-row-actions">
            <Select label={`Options for ${row.title}`} value="" options={[{ value: '', label: 'Other options…', disabled: true }, ...options]} onChange={(v) => { onChoose(v); }} className="gy-row-select" menu disabled={busy} />
            {row.dismissable && row.state !== 'done' && <button type="button" className="gy-link" disabled={busy} aria-label={`Dismiss ${row.title}`} onClick={onDismiss}>Dismiss</button>}
          </div>
        )}
      </div>
    </div>
  );
}
