import type { progress } from '../setup/progress';
import type { Severity } from '../setup/types';

const LEFT: { sev: Severity; key: 'errors' | 'warnings' | 'notices'; one: string; many: string }[] = [
  { sev: 'error', key: 'errors', one: 'blocker', many: 'blockers' },
  { sev: 'warning', key: 'warnings', one: 'recommended', many: 'recommended' },
  { sev: 'notice', key: 'notices', one: 'notice', many: 'notices' },
];

/** One bar filled to done/total in the colour of the worst open severity, with a button per severity that jumps to its first open row. */
export function ProgressBar({ counts, onJump }: { counts: ReturnType<typeof progress>; onJump: (s: Severity) => void }) {
  const { total, done } = counts;
  const left = LEFT.filter((l) => counts[l.key] > 0);
  const severity = left[0]?.sev ?? 'done';
  return (
    <div className="gy-progress">
      <div className="gy-progress-track" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuenow={done} aria-valuemax={total}>
        <span className="gy-progress-fill" data-severity={severity} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <div className="gy-progress-legend">
        {left.length === 0 && <span className="gy-muted">All set</span>}
        {left.map((l, i) => {
          const n = counts[l.key];
          const word = n === 1 ? l.one : l.many;
          return (
            <span key={l.sev}>
              {i > 0 && <span className="gy-muted" aria-hidden="true">·</span>}
              <button type="button" className="gy-progress-btn" data-severity={l.sev} aria-label={`${n} ${word} left, go to the first`} onClick={() => onJump(l.sev)}>
                {n} {word}
              </button>
            </span>
          );
        })}
        {left.length > 0 && <span className="gy-muted">left</span>}
      </div>
    </div>
  );
}
