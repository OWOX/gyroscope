import { Check, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BLOCKS } from '../setup/catalog';
import { isOpen, progress } from '../setup/progress';
import type { Row, Severity } from '../setup/types';
import { CollapsibleCard } from './CollapsibleCard';
import { LoadingBar } from './LoadingBar';
import { ProgressBar } from './ProgressBar';
import { SetupRow } from './SetupRow';

export interface SetupTabProps {
  rows: Row[]; loading: boolean; readOnly: boolean; busyRow: string | null; message: string | null;
  onChoose: (rowId: string, optionId: string) => void; onDismiss: (rowId: string) => void; onRetry: () => void; onOpen: (path: string) => void;
}

const ORDER: Severity[] = ['error', 'warning', 'notice'];
const worst = (rows: Row[]): Severity | null => ORDER.find((s) => rows.some((r) => isOpen(r) && r.severity === s)) ?? null;
const SeverityIcon = ({ s }: { s: Severity | null }) => s
  ? <span className="gy-row-icon" data-severity={s} role="img" aria-label={`${s} left`}><Circle size={12} fill="currentColor" /></span>
  : <span className="gy-row-icon" data-done="true" role="img" aria-label="All set"><Check size={14} /></span>;

export function SetupTab({ rows, loading, readOnly, busyRow, message, onChoose, onDismiss, onRetry, onOpen }: SetupTabProps) {
  // the row a jump is heading for; its block opens through the card's `attention`, then the effect opens its group and focuses it
  const [target, setTarget] = useState<Row | null>(null);
  const jump = (s: Severity) => setTarget(rows.find((r) => isOpen(r) && r.severity === s) ?? null);
  useEffect(() => {
    if (!target) return;
    const el = [...document.querySelectorAll<HTMLElement>('[data-row-id]')].find((e) => e.dataset.rowId === target.id);
    const group = el?.closest('details');
    if (group) group.open = true;
    setTarget(null);
    // the card unfolds on the next render, and a folded (inert) row can't take focus yet
    setTimeout(() => {
      el?.scrollIntoView?.({ block: 'center' });
      el?.querySelector<HTMLElement>('button, [role="combobox"]')?.focus({ preventScroll: true });
    }, 0);
  }, [target]);
  const renderRow = (r: Row) => (
    <SetupRow key={r.id} row={r} readOnly={readOnly} busy={busyRow === r.id} onChoose={(o) => onChoose(r.id, o)} onDismiss={() => onDismiss(r.id)} onRetry={onRetry} onOpen={onOpen} />
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
      <div className="gy-setup-blocks">
      {BLOCKS.map((b) => {
        const mine = rows.filter((r) => r.block === b.id);
        if (mine.length === 0) return null;
        const groups = [...new Set(mine.filter((r) => r.group).map((r) => r.group!))];
        const loose = mine.filter((r) => !r.group);
        const left = mine.filter(isOpen).length;
        return (
          <CollapsibleCard key={b.id} variant="band" icon={b.icon} label={b.title} collapsed={!mine.some(isOpen)} attention={target?.block === b.id} status={<SeverityIcon s={worst(mine)} />}
            title={<span className="gy-setup-title"><span className="gy-setup-name">{b.title}</span><span className="gy-setup-count" data-testid="block-count">{left > 0 ? `${left} left` : mine.length}</span><span className="gy-muted gy-setup-sub">{b.question}</span></span>}>
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
    </div>
  );
}
