import { memoryCollections } from './collections';
import { EMPTY_SETUP, legacyCore, loadSetup, loadSuggestions, readSetup, saveSetup, saveSuggestion, SettingsConflict } from './settings';
import type { ProjectSettingsV5 } from '../types';

const goal = { martId: 'orders', measure: { field: 'revenue', fn: 'SUM' as const }, dateField: 'date', kind: 'flow' as const, alias: 'Revenue', plan: null };

test('nothing stored reads as empty settings', async () => {
  const ctx = memoryCollections();
  expect((await loadSetup(ctx)).settings).toEqual(EMPTY_SETUP);
});

test('a 0.4 doc reads as empty, keeps its threshold, and hands its core ids to the recommendations', async () => {
  const ctx = memoryCollections();
  await ctx.collections('settings').put('project', { thresholdPct: 15, industry: 'saas', coreClasses: [{ martId: 'users', why: 'x' }, { martId: 'plans', why: '' }], weekStart: 'sunday' });
  const { settings, legacyCore: core } = await loadSetup(ctx);
  expect(settings).toEqual({ ...EMPTY_SETUP, thresholdPct: 15 });
  expect(core).toEqual(['users', 'plans']);
});

test('a v5 doc round-trips; malformed parts fall back to empty', () => {
  const s: ProjectSettingsV5 = { ...EMPTY_SETUP, goal, coreClasses: ['users'], updatedAt: '2026-11-14T00:00:00.000Z', updatedBy: 'u1' };
  expect(readSetup(s)).toEqual(s);
  expect(readSetup({ v: 5, goal: { martId: 3 }, coreClasses: 'x', thresholdPct: 500 })).toEqual({ ...EMPTY_SETUP, thresholdPct: 100 });
});

test('needleContexts: settings saved before it read as null (every context), a stored list is kept, junk reads as null', async () => {
  expect(EMPTY_SETUP.needleContexts).toBeNull();
  expect(readSetup({ v: 5, goal: null, coreClasses: [] }).needleContexts).toBeNull();
  expect(readSetup({ v: 5, needleContexts: ['a', 3, '', 'b:1.x'] }).needleContexts).toEqual(['a', 'b:1.x']);
  expect(readSetup({ v: 5, needleContexts: [] }).needleContexts).toEqual([]);
  expect(readSetup({ v: 5, needleContexts: 'a' }).needleContexts).toBeNull();
  expect(readSetup({ thresholdPct: 10 }).needleContexts).toBeNull();
  const ctx = memoryCollections();
  await ctx.collections('settings').put('project', { v: 5, goal: null, coreClasses: ['x'] });
  expect((await loadSetup(ctx)).settings.needleContexts).toBeNull();
});

test('a save stamps who and when, and keeps keys the settings do not own', async () => {
  const ctx = memoryCollections();
  await ctx.collections('settings').put('project', { weekStart: 'sunday' });
  const saved = await saveSetup(ctx, EMPTY_SETUP, { ...EMPTY_SETUP, goal }, 'Ann', new Date('2026-11-14T10:00:00Z'));
  expect(saved).toMatchObject({ goal, updatedBy: 'Ann', updatedAt: '2026-11-14T10:00:00.000Z' });
  expect((await ctx.collections<Record<string, unknown>>('settings').get('project'))!.document.weekStart).toBe('sunday');
});

test('a second save from a stale base throws SettingsConflict and writes nothing', async () => {
  const ctx = memoryCollections();
  const first = await saveSetup(ctx, EMPTY_SETUP, { ...EMPTY_SETUP, goal }, 'Ann', new Date('2026-11-14T10:00:00Z'));
  await expect(saveSetup(ctx, EMPTY_SETUP, { ...EMPTY_SETUP, coreClasses: ['x'] }, 'Bob', new Date('2026-11-14T10:01:00Z')))
    .rejects.toMatchObject({ name: 'SettingsConflict', by: 'Ann', at: '2026-11-14T10:00:00.000Z' });
  expect((await loadSetup(ctx)).settings).toEqual(first);
  expect(new SettingsConflict('a', 'b')).toBeInstanceOf(Error);
});

test('suggestions: items merge under one hash; a new hash starts over', async () => {
  const ctx = memoryCollections();
  const at = new Date('2026-11-14T10:00:00Z');
  await saveSuggestion(ctx, 'h1', 'goal.metric', 'opt-a', at);
  await saveSuggestion(ctx, 'h1', 'goal.plan', 'opt-b', at);
  expect((await loadSuggestions(ctx))!.items).toEqual({ 'goal.metric': 'opt-a', 'goal.plan': 'opt-b' });
  await saveSuggestion(ctx, 'h2', 'goal.plan', 'opt-c', at);
  expect(await loadSuggestions(ctx)).toEqual({ inputHash: 'h2', at: at.toISOString(), items: { 'goal.plan': 'opt-c' } });
});

test('legacyCore reads only well-formed entries', () => {
  expect(legacyCore({ coreClasses: [{ martId: 'a' }, { nope: 1 }, 'b'] })).toEqual(['a']);
  expect(legacyCore(null)).toEqual([]);
});
