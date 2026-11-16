import type { LucideIcon } from 'lucide-react';
import type { ProjectSettingsV5 } from '../types';

export type Severity = 'error' | 'warning' | 'notice';
export type BlockId = 'goal' | 'teams' | 'metrics' | 'ratios' | 'checks' | 'housekeeping';
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
  /** Choosing this option dismisses the row, so the row needs no "Not needed" radio of its own. */
  declines?: true;
  /** An OWOX page path for the Data Mart, or the field, this option points at. */
  link?: string;
  /** The destination's name for the link's label: a field with its Data Mart, or a Data Mart title. */
  linkLabel?: string;
  /** The Data Mart the link points at, for its icon. */
  martId?: string;
  /** The schema description of the field this option names. */
  description?: string }
/** One checkbox of a multi-pick row: a Data Mart field. */
export interface MultiItem { path: string; label: string; martId: string; recommended: boolean; description?: string; link?: string; linkLabel?: string }
/** A row that picks a set of fields with checkboxes; a pick's option id is `shown:set:<path>|<path>`. */
export interface Multi { max: number; items: MultiItem[]; checked: string[]; action: (paths: string[]) => Action | undefined }
export interface Row {
  id: string;                 // e.g. 'goal.metric', 'team:<ctxId>.plan', 'class:<martId>.key', 'metric:<metricId>.format', 'ratio:<id>', 'check.goal.pk'
  block: BlockId;
  /** A per-class or per-team sub-group title, such as the class title. */
  group?: string;
  /** The Data Mart's id when the group is a Data Mart, to look its icon up. */
  groupId?: string;
  /** The group's description (Markdown), for the (?) on its label. */
  groupDescription?: string;
  /** The OWOX page of the group, for the link on its label. */
  groupLink?: string;
  /** The current value as separate names, for rows that list several (each shows the context icon). */
  currentList?: string[];
  title: string; question: string; why: string;
  severity: Severity;
  state: RowState;
  current: string | null;     // shown value; null is "Not set"
  /** The Data Mart the current value's field belongs to, for its icon; absent when the value is not a field. */
  currentMartId?: string;
  /** The schema description of the current value's field. */
  currentDescription?: string;
  multi?: Multi;
  options: Option[];          // never empty; exactly one recommended
  aiPending: boolean;         // an AI pick may still replace the recommendation
  detail?: string;            // broken or error reason
  dismissable: boolean;
  /** The saved state is a dismissal ("Not needed", or a skipped ratio): the row is done and can be changed back. */
  dismissed?: true;
}
export interface BlockInfo { id: BlockId; title: string; question: string; why: string; icon: LucideIcon }
