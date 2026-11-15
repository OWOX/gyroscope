import { loadGraph } from './graph-load';
import { fakeOwox } from '../owox/fake';

const mart = (id: string) => ({ id, title: id, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: '' });

test('a Data Mart whose schema fails is in failed, the rest load, and progress ends at total', async () => {
  const owox = fakeOwox({
    projectDescription: null, contexts: [], marts: [mart('a'), mart('b')],
    details: { a: { id: 'a', title: 'A', fields: [] } },
    blendables: { a: { availableSources: [], mainUniqueCountKeyFields: [] }, b: { availableSources: [], mainUniqueCountKeyFields: [] } },
  });
  const progress: [number, number][] = [];
  const g = await loadGraph(owox, (d, t) => progress.push([d, t]));
  expect(g.nodes.map((n) => n.id)).toEqual(['a']);
  expect([...g.failed.keys()]).toEqual(['b']);
  expect(progress.at(-1)).toEqual([2, 2]);
});
