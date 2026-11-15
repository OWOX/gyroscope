import { Check, Circle } from 'lucide-react';
import { BLOCKS } from '../setup/catalog';
import { isOpen, progress } from '../setup/progress';
import type { Row, Severity } from '../setup/types';
import { CollapsibleCard } from './CollapsibleCard';
import { InfoTip } from './InfoTip';
import { LoadingBar } from './LoadingBar';
import { ProgressBar } from './ProgressBar';
import { SetupRow } from './SetupRow';

export interface SetupTabProps {
  rows: Row[]; loading: boolean; readOnly: boolean; busyRow: string | null; message: string | null;
  onChoose: (rowId: string, optionId: string) => void; onDismiss: (rowId: string) => void; onRetry: () => void;
}

const ORDER: Severity[] = ['error', 'warning', 'notice'];
const worst = (rows: Row[]): Severity | null => ORDER.find((s) => rows.some((r) => isOpen(r) && r.severity === s)) ?? null;
const SeverityIcon = ({ s }: { s: Severity | null }) => s
  ? <span className="gy-row-icon" data-severity={s} aria-label={`${s} left`}><Circle size={12} fill="currentColor" /></span>
  : <span className="gy-row-icon" data-done="true" aria-label="All set"><Check size={14} /></span>;

export function SetupTab({ rows, loading, readOnly, busyRow, message, onChoose, onDismiss, onRetry }: SetupTabProps) {
  const jump = (s: Severity) => {
    const first = rows.find((r) => isOpen(r) && r.severity === s);
    if (!first) return;
    const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(first.id)}"]`);
    el?.scrollIntoView?.({ block: 'center' });
    el?.querySelector<HTMLElement>('button')?.focus();
  };
  const renderRow = (r: Row) => (
    <SetupRow key={r.id} row={r} readOnly={readOnly} busy={busyRow === r.id} onChoose={(o) => onChoose(r.id, o)} onDismiss={() => onDismiss(r.id)} />
  );
  return (
    <div className="gy-setup">
      {loading && <LoadingBar />}
      {message && (
        <div className="gy-setup-banner" role="status">
          <span>{message}</span>
          <button type="button" className="gy-btn" onClick={onRetry}>Retry</button>
        </div>
      )}
      <ProgressBar counts={progress(rows)} onJump={jump} />
      {BLOCKS.map((b) => {
        const mine = rows.filter((r) => r.block === b.id);
        if (mine.length === 0) return null;
        const groups = [...new Set(mine.filter((r) => r.group).map((r) => r.group!))];
        const loose = mine.filter((r) => !r.group);
        return (
          <CollapsibleCard key={b.id} label={b.title} collapsed={!mine.some(isOpen)} status={<SeverityIcon s={worst(mine)} />}
            title={<span className="gy-setup-title">{b.title} <InfoTip name={b.title} text={`${b.question} ${b.why}`} /><span className="gy-muted gy-setup-sub">{b.question}</span></span>}>
            <p className="gy-muted gy-setup-why">{b.why}</p>
            {loose.map(renderRow)}
            {groups.map((g) => {
              const inGroup = mine.filter((r) => r.group === g);
              return (
                <details key={g} className="gy-setup-group" open={inGroup.some(isOpen)}>
                  <summary>{g}</summary>
                  {inGroup.map(renderRow)}
                </details>
              );
            })}
          </CollapsibleCard>
        );
      })}
    </div>
  );
}
