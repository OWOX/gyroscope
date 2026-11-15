import type { ReactNode } from 'react';
import type { Blocked as BlockedInfo, BlockCode } from '../types';

// [settings] and [plugins] in a step become links to that OWOX page
const PAGES = {
  settings: { label: 'Project settings', path: (projectId: string) => `/ui/${projectId}/project-settings` },
  plugins: { label: 'Plugins', path: (projectId: string) => `/ui/${projectId}/plugins` },
} as const;
type Page = keyof typeof PAGES;
const PAGE_TOKEN = new RegExp(`\\[(${Object.keys(PAGES).join('|')})\\]`);

const STEPS: Record<BlockCode, string[]> = {
  NO_GOAL: ['Open Setup and answer "What is the main business goal?"'],
  GOAL_NO_DATE: ['Open Setup and answer "Which date does each value belong to?" for the Business Critical Number.'],
  GOAL_PLACEHOLDER: [],
  GOAL_FIELD_NOT_FOUND: [
    'Open Setup and answer "What is the main business goal?" again: the field was renamed or removed.',
    'Pick the field in its Data Mart and the date that goes with it.',
  ],
  GOAL_NO_PRIMARY_KEY: [
    'Open the goal Data Mart in OWOX and mark its primary key fields in the schema.',
    'Open Setup and check that "Goal Data Mart Primary Key" is clear, then Retry.',
  ],
  GOAL_NO_ACCESS: [
    'Ask a project admin with access to the goal Data Mart to finish Setup,',
    'or ask for access to it in OWOX, then Retry.',
  ],
};
STEPS.GOAL_PLACEHOLDER = STEPS.NO_GOAL;

function stepContent(step: string, projectId: string, onOpen?: (path: string) => void): ReactNode[] {
  return step.split(PAGE_TOKEN).map((part, i) => {
    if (i % 2 === 0) return part;
    const page = PAGES[part as Page];
    return onOpen
      ? <button key={i} type="button" className="gy-link" onClick={() => onOpen(page.path(projectId))}>{page.label}</button>
      : page.label;
  });
}

export function Blocked({ blocked, projectId, onRetry, onOpenSetup, onBack, backLabel = 'Back to canvas', embedded = false, onOpen, isAdmin = true }: {
  blocked: BlockedInfo; projectId: string; onRetry: () => void; onOpenSetup: () => void; onBack?: () => void; backLabel?: string;
  /** Inside a page that has its own h1: the heading drops to h2. */
  embedded?: boolean;
  /** Goes to an OWOX page; without it the page names show as plain text. */
  onOpen?: (path: string) => void;
  /** A member who isn't a project admin is told to ask one; Setup opens read-only. */
  isAdmin?: boolean;
}) {
  const title = "Goal can't be tracked";
  return (
    <div className="gy-blocked">
      {embedded ? <h2>{title}</h2> : <h1>{title}</h1>}
      <p>{blocked.detail}</p>
      {blocked.mismatches.length > 0 && (
        <ol>{blocked.mismatches.map((m, i) => <li key={i}>{m}</li>)}</ol>
      )}
      <h2>How to fix</h2>
      {isAdmin
        ? <ol>{STEPS[blocked.code].map((s) => <li key={s}>{stepContent(s, projectId, onOpen)}</li>)}</ol>
        : <p>Ask a project admin to finish Setup.</p>}
      <p><button type="button" className="gy-btn gy-btn-primary" onClick={onOpenSetup}>Open Setup</button>
        {' '}<button type="button" className="gy-btn" onClick={onRetry}>Retry</button>
        {onBack && <>{' '}<button type="button" className="gy-btn" onClick={onBack}>{backLabel}</button></>}
      </p>
    </div>
  );
}
