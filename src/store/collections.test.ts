import { loadPreferences, loadViewSettings, memoryCollections, savePreferences, saveViewSettings } from './collections';
import { DEFAULT_SETTINGS } from '../types';

test('view settings use defaults', async () => {
  expect(await loadViewSettings(memoryCollections())).toEqual(DEFAULT_SETTINGS);
});

test('a 0.3 default preset is ignored once; a 0.4 one is kept', async () => {
  const store = memoryCollections();
  await store.collections('preferences').put('defaults', { defaultPreset: 'qtd' });
  expect((await loadViewSettings(store)).defaultPreset).toBeNull();
  await saveViewSettings(store, { defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' });
  expect(await loadViewSettings(store)).toEqual({ defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' });
});
test('view settings fall back to the old project fields for comparison and week start', async () => {
  const store = memoryCollections();
  await store.collections('settings').put('project', { thresholdPct: 30, comparisonDefault: false, weekStart: 'sunday' });
  expect(await loadViewSettings(store)).toEqual({ defaultPreset: null, comparisonDefault: false, weekStart: 'sunday' });
});
test('preferences from 0.3 are ignored once', async () => {
  const store = memoryCollections();
  await store.collections('preferences').put('current', { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' } });
  expect(await loadPreferences(store)).toBeNull();
});
test('a null range is saved and read back', async () => {
  const store = memoryCollections();
  await savePreferences(store, { range: null, compare: { kind: 'off' } });
  expect(await loadPreferences(store)).toEqual({ range: null, compare: { kind: 'off' } });
});

test('an unknown default preset reads as null', async () => {
  const ctx = memoryCollections();
  await saveViewSettings(ctx, { defaultPreset: 'next_decade' as never, comparisonDefault: true, weekStart: 'monday' });
  expect((await loadViewSettings(ctx)).defaultPreset).toBeNull();
  await saveViewSettings(ctx, { defaultPreset: 'constructor' as never, comparisonDefault: true, weekStart: 'monday' });
  expect((await loadViewSettings(ctx)).defaultPreset).toBeNull();
});

test('weekStart is validated', async () => {
  const ctx = memoryCollections();
  await saveViewSettings(ctx, { defaultPreset: null, comparisonDefault: true, weekStart: 'sunday' });
  expect((await loadViewSettings(ctx)).weekStart).toBe('sunday');
  await saveViewSettings(ctx, { defaultPreset: null, comparisonDefault: true, weekStart: 'friday' as never });
  expect((await loadViewSettings(ctx)).weekStart).toBe('monday');
});

test('preferences round trip', async () => {
  const ctx = memoryCollections();
  expect(await loadPreferences(ctx)).toBeNull();
  const p = { range: { kind: 'custom', window: { from: '2026-10-01', to: '2026-10-09' } }, compare: { kind: 'preset', preset: 'year_before' } } as const;
  await savePreferences(ctx, p);
  expect(await loadPreferences(ctx)).toEqual(p);
  await savePreferences(ctx, { range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'off' } });
  expect(await loadPreferences(ctx)).toEqual({ range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'off' } });
});

test('invalid preference parts fall back to null', async () => {
  const ctx = memoryCollections();
  const put = (doc: unknown) => ctx.collections<unknown>('preferences').put('current', typeof doc === 'object' ? { ...(doc as object), v: 4 } : doc);
  await put({ range: { kind: 'preset', preset: 'next_decade' }, compare: { kind: 'preset', preset: 'previous_period' } });
  expect(await loadPreferences(ctx)).toEqual({ range: null, compare: { kind: 'preset', preset: 'previous_period' } });
  await put({ range: { kind: 'custom', window: { from: '2026-10-09', to: '2026-10-01' } }, compare: { kind: 'custom', window: { from: '2026-13-01', to: '2026-13-02' } } });
  expect(await loadPreferences(ctx)).toBeNull();
  await put({ range: { kind: 'preset', preset: 'constructor' }, compare: { kind: 'preset', preset: 'bogus' } });
  expect(await loadPreferences(ctx)).toBeNull();
  await put('junk');
  expect(await loadPreferences(ctx)).toBeNull();
});

test('a stored this_* preset loads as its to-date id, in view settings and in preferences', async () => {
  const ctx = memoryCollections();
  await ctx.collections<unknown>('preferences').put('defaults', { v: 4, defaultPreset: 'this_month' });
  expect((await loadViewSettings(ctx)).defaultPreset).toBe('mtd');
  await ctx.collections<unknown>('preferences').put('current', { v: 4, range: { kind: 'preset', preset: 'this_week' }, compare: { kind: 'off' } });
  expect(await loadPreferences(ctx)).toEqual({ range: { kind: 'preset', preset: 'wtd' }, compare: { kind: 'off' } });
  await savePreferences(ctx, { range: { kind: 'preset', preset: 'cur_month' }, compare: { kind: 'off' } });
  expect((await loadPreferences(ctx))!.range).toEqual({ kind: 'preset', preset: 'cur_month' });
});

test('memoryCollections keeps the parentId of a put', async () => {
  const m = memoryCollections();
  await m.collections('mart-cache').put('a:qtd:off', { x: 1 }, { parentId: 'a' });
  expect(m.parentOf('mart-cache', 'a:qtd:off')).toBe('a');
});
