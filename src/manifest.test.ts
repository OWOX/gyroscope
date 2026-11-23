import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, '..', f), 'utf8'));

test('the 0.6 compatibility line serves the page and actions from Gyroscope’s Void origin', () => {
  const manifest = read('plugin.json');
  expect(read('package.json').version).toMatch(/^0\.6\.\d+$/);
  expect(manifest.delivery.url).toBe('https://gyroscope.owox.app/');
  expect(manifest.backend.url).toBe('/owox');
});

test('the manifest keeps the project collections from 0.5', () => {
  const cols = read('plugin.json').collections as { name: string; scope: string }[];
  expect(cols).toContainEqual({ name: 'suggestions', scope: 'project' });
  for (const name of ['model', 'ontology_project', 'settings']) expect(cols.some((c) => c.name === name)).toBe(true);
});

test('the backend runs the warm-cache action within the OWOX limit, and the cache collection is bound to the Data Mart', () => {
  const m = read('plugin.json');
  expect(m.backend.actions['warm-cache'].timeoutSeconds).toBe(300);
  expect(m.collections.find((c: { name: string }) => c.name === 'mart-cache')).toMatchObject({ scope: 'project', entityBinding: { type: 'data-mart' } });
  expect(m.collections.some((c: { name: string }) => c.name === 'schedule-models')).toBe(false);
});
