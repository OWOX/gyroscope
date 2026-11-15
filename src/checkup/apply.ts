import type { CollectionsLike } from '../store/collections';
import { saveProjectSettings } from '../store/collections';
import type { OwoxLike } from '../owox/sources';
import { addMartToContext, editDescription, refusedBy, Unavailable } from '../setup/actions';
import type { ProjectSettings } from '../types';
import { describeError } from '../lib/errors';
import { setCriticalFact, setCriticalPlan } from './tables';
import type { ApplyTarget } from './types';

export type ApplyResult = { ok: true } | { ok: false; refused: true; snippet: string } | { ok: false; refused: false; error: string };

export interface ApplyDeps { owox: OwoxLike; store: CollectionsLike; settings: ProjectSettings; onModel: (action: 'build' | 'rebuild') => void }

/** The text a person would paste by hand when a write is refused. */
function snippetOf(t: ApplyTarget): string {
  switch (t.kind) {
    case 'description_append': return t.text;
    case 'critical_fact': return setCriticalFact(null, t.metric, t.factLink);
    case 'critical_plan': return t.planLink;
    case 'context_create': return t.description || t.name;
    case 'mart_add_context': return `Add ${t.martTitle} to the context ${t.contextName}`;
    case 'settings': return JSON.stringify(t.patch);
    case 'model': return t.action;
  }
}

async function write(t: ApplyTarget, { owox, store, onModel }: ApplyDeps): Promise<void> {
  switch (t.kind) {
    case 'settings':
      if (Object.keys(t.patch).length) await saveProjectSettings(store, t.patch);
      return;
    case 'description_append': await editDescription(owox, t.scope, (cur) => (cur?.trim() ? `${cur}\n\n${t.text}` : t.text)); return;
    case 'critical_fact': await editDescription(owox, t.scope, (cur) => setCriticalFact(cur, t.metric, t.factLink)); return;
    case 'critical_plan':
      await editDescription(owox, t.scope, (cur) => {
        const next = setCriticalPlan(cur, t.planLink);
        if (next === null) throw new Error('Add the critical number first');
        return next;
      });
      return;
    case 'context_create':
      if (!owox.postJson) throw new Unavailable();
      await owox.postJson('/api/contexts', { name: t.name, description: t.description });
      return;
    case 'mart_add_context': await addMartToContext(owox, t.martId, t.contextId); return;
    case 'model': onModel(t.action); return;
  }
}

/** Writes one answer from the current state, not the state the run saw. A 401 or 403, or a client that can't write, returns the snippet; any other failure returns its message. */
export async function applyTarget(t: ApplyTarget, deps: ApplyDeps): Promise<ApplyResult> {
  try {
    await write(t, deps);
    return { ok: true };
  } catch (e) {
    if (e instanceof Unavailable || refusedBy(e)) return { ok: false, refused: true, snippet: snippetOf(t) };
    return { ok: false, refused: false, error: describeError(e) };
  }
}
