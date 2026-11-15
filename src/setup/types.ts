import type { LucideIcon } from 'lucide-react';
import type { ProjectSettingsV5 } from '../types';

export type Severity = 'error' | 'warning' | 'notice';
export type BlockId = 'goal' | 'core' | 'teams' | 'metrics' | 'ratios' | 'checks' | 'housekeeping';
export type RowState = 'open' | 'done' | 'broken' | 'error';
export type Scope = 'project' | { contextId: string };
/** What choosing an option does. `set` returns the next settings; the rest write to OWOX or open a page. */
export type Action =
  | { kind: 'set'; next: (s: ProjectSettingsV5) => ProjectSettingsV5 }
  | { kind: 'append'; scope: Scope; text: string }
  | { kind: 'teams'; teams: { name: string; martIds: string[] }[] }
  | { kind: 'open'; path: string };
/** `keep` marks an option that leaves the saved value as it is, so a finished row has nothing to accept. */
export interface Option { id: string; label: string; recommended: boolean; action: Action; keep?: boolean;
  /** An OWOX page path for the Data Mart, or the field, this option points at. */
  link?: string;
  /** The destination's name for the link's label: a field with its Data Mart, or a Data Mart title. */
  linkLabel?: string }
export interface Row {
  id: string;                 // e.g. 'goal.metric', 'team:<ctxId>.plan', 'class:<martId>.key', 'metric:<metricId>.format', 'ratio:<id>', 'check.goal.pk'
  block: BlockId;
  /** A per-class or per-team sub-group title, such as the class title. */
  group?: string;
  title: string; question: string; why: string;
  severity: Severity;
  state: RowState;
  current: string | null;     // shown value; null is "Not set"
  options: Option[];          // never empty; exactly one recommended
  aiPicked: boolean;          // the recommendation is the AI's pick, not the code's
  aiPending: boolean;         // an AI pick may still replace the recommendation
  detail?: string;            // broken or error reason
  dismissable: boolean;
}
export interface BlockInfo { id: BlockId; title: string; question: string; why: string; icon: LucideIcon }
