import { Check, Loader2 } from 'lucide-react';
import type { Row } from '../setup/types';
import { Select } from './Select';

/** One setup question: what it is now, what is recommended, and the ways to change it. */
export function SetupRow({ row, readOnly, busy, onChoose, onDismiss }: {
  row: Row; readOnly: boolean; busy: boolean; onChoose: (optionId: string) => void; onDismiss: () => void;
}) {
  const rec = row.options.find((o) => o.recommended);
  const showChip = !!rec && rec.label !== row.current;
  const options = row.options.map((o) => ({ value: o.id, label: o.recommended ? `${o.label} (Recommended)` : o.label }));
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
        {showChip && rec && (readOnly
          ? <span className="gy-chip gy-row-chip">✨ {rec.label}</span>
          : (
            <button type="button" className="gy-chip gy-row-chip" aria-label={`Accept ${rec.label}`} disabled={busy} onClick={() => onChoose(rec.id)}>
              {row.aiPending ? <Loader2 size={12} className="gy-spin" aria-hidden="true" /> : <span aria-hidden="true">✨</span>} {rec.label} <span className="gy-row-accept">Accept</span>
            </button>
          ))}
        {!readOnly && (
          <div className="gy-row-actions">
            <Select label={`Options for ${row.title}`} value="" options={[{ value: '', label: 'Other options…', disabled: true }, ...options]} onChange={(v) => { if (!busy) onChoose(v); }} className="gy-row-select" />
            {row.dismissable && row.state !== 'done' && <button type="button" className="gy-link" disabled={busy} onClick={onDismiss}>Dismiss</button>}
          </div>
        )}
      </div>
    </div>
  );
}
