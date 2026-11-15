import type { progress } from '../setup/progress';
import type { Severity } from '../setup/types';

const SEGMENTS = [['done', 'done'], ['errors', 'error'], ['warnings', 'warning'], ['notices', 'notice']] as const;

const LEFT: { sev: Severity; key: 'errors' | 'warnings' | 'notices'; one: string; many: string }[] = [
  { sev: 'error', key: 'errors', one: 'blocker', many: 'blockers' },
  { sev: 'warning', key: 'warnings', one: 'recommended', many: 'recommended' },
  { sev: 'notice', key: 'notices', one: 'notice', many: 'notices' },
];

/** One bar split by what is done and what is left per severity, with a button per severity that jumps to its first open row. */
export function ProgressBar({ counts, onJump }: { counts: ReturnType<typeof progress>; onJump: (s: Severity) => void }) {
  const { total, done } = counts;
  const left = LEFT.filter((l) => counts[l.key] > 0);
  return (
    <div className="gy-progress">
      <div className="gy-progress-track" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuenow={done} aria-valuemax={total}>
        {SEGMENTS.map(([key, cls]) => counts[key] > 0 && <span key={key} className={`gy-progress-${cls}`} style={{ width: `${(counts[key] / total) * 100}%` }} />)}
      </div>
      <div className="gy-progress-legend">
        {left.length === 0 && <span className="gy-muted">All set</span>}
        {left.map((l) => {
          const n = counts[l.key];
          const word = n === 1 ? l.one : l.many;
          return (
            <button key={l.sev} type="button" className="gy-progress-btn" data-severity={l.sev} aria-label={`${n} ${word} left, go to the first`} onClick={() => onJump(l.sev)}>
              {n} {word}
            </button>
          );
        })}
      </div>
    </div>
  );
}
