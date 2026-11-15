import { generateText, Output } from 'ai';
import { z } from 'zod';
import { hashString } from '../lib/hash';
import { flattenFields } from '../owox/sources';
import type { Graph } from '../model/graph-load';
import type { Row } from './types';

/** Like a plain generate call, with the answer's shape chosen by the caller. */
export type GenerateWith = (prompt: string, schema: z.ZodType) => Promise<unknown>;

export function aiGenerateWith(model: unknown, signal?: AbortSignal): GenerateWith {
  return async (prompt, schema) => {
    const { output } = await generateText({
      model: model as never, // the SDK's provider-v4 handle; ai@7 accepts LanguageModelV4
      output: Output.object({ schema }),
      prompt,
      temperature: 0,
      abortSignal: signal,
    });
    return output;
  };
}

export const AI_ROWS = /^(goal\.metric|goal\.plan|core\.classes|teams\.exist|team:[^.]+\.(metric|plan)|metric:.+\.plan|ratio:.+)$/;
const MAX_OPTIONS = 30;
const Pick = z.object({ pick: z.number().int() });

/** Changes when what a recommendation reads changes: descriptions, and each Data Mart's title and fields. */
export const factsHash = (g: Graph): string => hashString(JSON.stringify([
  g.inputs.projectDescription,
  [...g.inputs.contexts].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, c.description]),
  [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => [n.id, n.title, flattenFields(n.detail.fields).map((x) => `${x.path}:${x.field.type}`).sort()]),
]));

/** The AI's choice among the row's options, by index; null when it can't answer. Never throws. */
export async function aiPick(row: Row, facts: { projectDescription: string | null; contextName?: string }, generate: GenerateWith): Promise<string | null> {
  const opts = row.options.slice(0, MAX_OPTIONS);
  if (opts.length === 1) return opts[0]!.id;
  const prompt = [
    `A business user is asked: "${row.question}" (${row.title}${facts.contextName ? `, for ${facts.contextName}` : ''}).`,
    'Pick the best answer from the OPTIONS by its index. Use only the facts given below. Answer with the index only, no Markdown.',
    `PROJECT DESCRIPTION:\n${facts.projectDescription?.trim() || '(empty)'}`,
    `OPTIONS:\n${opts.map((o, i) => `${i}: ${o.label}`).join('\n')}`,
  ].join('\n\n');
  try {
    const r = Pick.safeParse(await generate(prompt, Pick));
    return r.success && r.data.pick >= 0 && r.data.pick < opts.length ? opts[r.data.pick]!.id : null;
  } catch { return null; }
}
