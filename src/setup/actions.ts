import type { CollectionsLike } from '../store/collections';
import { saveSetup, SettingsConflict } from '../store/settings';
import { contextPath, martPath, type OwoxLike } from '../owox/sources';
import { describeError, statusesOf } from '../lib/errors';
import type { ProjectSettingsV5 } from '../types';
import type { Action, Scope } from './types';

export type ActionResult =
  | { ok: true; settings: ProjectSettingsV5 }
  | { ok: false; conflict: SettingsConflict }
  | { ok: false; error: string; snippet?: string };

export interface ActionDeps { owox: OwoxLike; store: CollectionsLike; settings: ProjectSettingsV5; by: string; now: () => Date; open: (path: string) => void }

/** Thrown when OWOX can't take the write from this client; the caller turns it into a copy-ready snippet. */
export class Unavailable extends Error {}

export const refusedBy = (e: unknown) => statusesOf(e).some((s) => s === 401 || s === 403);

/** PUTs through the client, or throws Unavailable when it can't. */
export const putOf = (owox: OwoxLike) => (path: string, body: unknown) => { if (!owox.putJson) throw new Unavailable(); return owox.putJson(path, body); };

/** Reads the description now and writes `change(current)` back; the context keeps its current name. A null from `change` writes nothing. */
export async function editDescription(owox: OwoxLike, scope: Scope, change: (current: string | null) => string | null): Promise<void> {
  const put = putOf(owox);
  if (scope === 'project') {
    const next = change((await owox.project.getSettings()).description);
    if (next === null) return;
    if (owox.project.updateDescription) await owox.project.updateDescription(next);
    else await put('/api/projects/settings/description', { description: next });
    return;
  }
  const c = (await owox.getJson<{ id: string; name: string; description?: unknown }[]>('/api/contexts')).find((x) => x.id === scope.contextId);
  if (!c) throw new Error('The context no longer exists');
  const next = change(typeof c.description === 'string' ? c.description : null);
  if (next !== null) await put(contextPath(c.id), { name: c.name, description: next });
}

/** Adds a Data Mart to a context, keeping the contexts it already has. */
export async function addMartToContext(owox: OwoxLike, martId: string, contextId: string): Promise<void> {
  const dm = await owox.getJson<{ contexts?: { id: string }[] }>(martPath(martId));
  // without a contexts list on the detail, the summary has it; never write a list built from nothing
  const current = Array.isArray(dm.contexts) ? dm.contexts : (await owox.dataMarts.list()).find((m) => m.id === martId)?.contexts;
  if (!current) throw new Error("Couldn't read the Data Mart's contexts");
  const ids = current.map((c) => c.id);
  if (!ids.includes(contextId)) ids.push(contextId);
  await putOf(owox)(martPath(martId, '/contexts'), { contextIds: ids });
}

const snippetOf = (a: Action): string | undefined =>
  a.kind === 'append' ? a.text : a.kind === 'teams' ? a.teams.map((t) => t.name).join('\n') : undefined;

/** Runs the chosen option's action. A 401 or 403, or a client that can't write, returns the snippet; a stale base returns the conflict. */
export async function runAction(a: Action, { owox, store, settings, by, now, open }: ActionDeps): Promise<ActionResult> {
  try {
    switch (a.kind) {
      case 'set': return { ok: true, settings: await saveSetup(store, settings, a.next(settings), by, now()) };
      case 'append':
        await editDescription(owox, a.scope, (cur) => (cur?.trim() ? `${cur}\n\n${a.text}` : a.text));
        return { ok: true, settings };
      case 'teams':
        if (!owox.postJson) throw new Unavailable();
        const existing = await owox.getJson<{ id: string; name: string }[]>('/api/contexts');
        for (const t of a.teams) {
          const same = (c: { name: string }) => c.name.toLowerCase() === t.name.toLowerCase();
          let id = existing.find(same)?.id;
          if (!id) {
            const made = await owox.postJson<{ id?: unknown }>('/api/contexts', { name: t.name, description: '' });
            id = typeof made?.id === 'string' ? made.id : (await owox.getJson<{ id: string; name: string }[]>('/api/contexts')).find(same)?.id;
          }
          if (!id) throw new Error(`Couldn't find the team ${t.name} after creating it`);
          for (const m of t.martIds) await addMartToContext(owox, m, id);
        }
        return { ok: true, settings };
      case 'open': open(a.path); return { ok: true, settings };
    }
  } catch (e) {
    if (e instanceof SettingsConflict) return { ok: false, conflict: e };
    if (e instanceof Unavailable || refusedBy(e)) return { ok: false, error: 'OWOX refused the write', snippet: snippetOf(a) };
    return { ok: false, error: describeError(e) };
  }
}
