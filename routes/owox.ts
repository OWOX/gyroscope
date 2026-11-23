import { createBackend } from '@owox/plugin-sdk/server';
import { defineHandler } from 'void';
import { WARM_ACTION } from '../src/schedules/input';
import { warmCache } from '../server/warm';

const backend = createBackend({
  repositoryId: '1297672440',
  hosts: ['https://app.owox.com'],
  actions: {
    [WARM_ACTION]: (input, ctx) => warmCache(input, {
      owox: ctx.owox,
      collections: (name) => ctx.collections(name),
      execution: ctx.execution,
    }),
  },
});

export const POST = defineHandler((ctx) => backend.fetch(ctx.req.raw));
