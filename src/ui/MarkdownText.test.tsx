import { render } from '@testing-library/react';
import { MarkdownText } from './MarkdownText';

const html = (text: string) => render(<MarkdownText text={text} />).container;

test('a link labelled with its own URL is one link, not two nested', () => {
  const d = html('[https://a.com](https://a.com)');
  expect(d.querySelectorAll('a')).toHaveLength(1);
  expect(d.querySelector('a a')).toBeNull();
});

test('asterisks inside words and double underscores stay literal', () => {
  const d = html('see __TABLES__ and price*qty and a*b');
  expect(d.querySelector('strong, em')).toBeNull();
  expect(d.textContent).toBe('see __TABLES__ and price*qty and a*b');
  expect(html('an *aside* here').querySelector('em')!.textContent).toBe('aside');
});

test('URLs keep balanced parentheses and drop trailing punctuation', () => {
  expect(html('[W](https://en.wikipedia.org/wiki/Foo_(bar))').querySelector('a')!.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  const d = html('See https://en.wikipedia.org/wiki/Foo_(bar).');
  expect(d.querySelector('a')!.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  expect(d.textContent).toBe('See https://en.wikipedia.org/wiki/Foo_(bar).');
});

test('a list after an intro line is a list; indented lines continue an item; numbering keeps its start', () => {
  const d = html('Metrics:\n- clicks\n  per day\n- cost\n\n3. three\n4. four');
  expect(d.querySelector('p')!.textContent).toBe('Metrics:');
  expect([...d.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['clicks per day', 'cost']);
  expect(d.querySelector('ol')!.getAttribute('start')).toBe('3');
});

// A runaway (quadratic) parse of this input takes minutes; the bound leaves room for a slow CI runner.
test('text full of unclosed marks renders quickly', () => {
  const t = performance.now();
  html('['.repeat(50_000) + '*'.repeat(20_000) + '**x'.repeat(10_000));
  expect(performance.now() - t).toBeLessThan(5000);
});

test('a heading is a bold small line, not an h1', () => {
  const d = html('## Metrics\nsome text\n###### Deep');
  expect([...d.querySelectorAll('.gy-md-h')].map((e) => [e.textContent, e.getAttribute('aria-level')])).toEqual([['Metrics', '2'], ['Deep', '6']]);
  expect(d.querySelector('h1, h2, h3')).toBeNull();
  expect(d.querySelector('p')!.textContent).toBe('some text');
  expect(html('#hashtag').querySelector('.gy-md-h')).toBeNull();
});

test('a pipe table renders a table with inline markup in its cells', () => {
  const d = html('| Role | Metric |\n|:--|--:|\n| Leading | [Plan\\_Data](https://x.y) |\n| a \\| b | **c** |');
  expect([...d.querySelectorAll('th')].map((e) => e.textContent)).toEqual(['Role', 'Metric']);
  const rows = [...d.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
  expect(rows).toEqual([['Leading', 'Plan_Data'], ['a | b', 'c']]);
  expect(d.querySelector('a')!.getAttribute('href')).toBe('https://x.y');
  expect(d.querySelector('strong')!.textContent).toBe('c');
  expect(d.querySelector('th')!.style.textAlign).toBe('left');
  expect(d.querySelectorAll('th')[1]!.style.textAlign).toBe('right');
  expect(d.querySelector('.gy-md-table table')).not.toBeNull();
});

test('a line with pipes but no separator row is a paragraph', () => {
  const d = html('a | b\nc | d');
  expect(d.querySelector('table')).toBeNull();
  expect(d.querySelector('p')!.textContent).toBe('a | b c | d');
});

test('backslash escapes show the bare character and stop a mark', () => {
  const d = html('Manual\\_gap\\_pages \\*not em\\* \\# \\` \\[x\\](y) \\| \\\\');
  expect(d.textContent).toBe('Manual_gap_pages *not em* # ` [x](y) | \\');
  expect(d.querySelector('em, a')).toBeNull();
  expect(html('a \\q').textContent).toBe('a \\q');
});

test('the real-context example: heading, table with a link, blank-line paragraph', () => {
  const d = html('## Metrics\n| Role | Metric |\n|---|---|\n| Leading | [Plan\\_Data](https://x.y) |\n\nManual\\_gap\\_pages');
  expect(d.querySelector('.gy-md-h')!.textContent).toBe('Metrics');
  expect(d.querySelector('td a')!.textContent).toBe('Plan_Data');
  expect(d.querySelector('p')!.textContent).toBe('Manual_gap_pages');
});

test('a huge table is capped and a table of pipes renders quickly', () => {
  const t = performance.now();
  const d = html(`${'|'.repeat(5000)}\n${'|-'.repeat(5000)}\n` + Array.from({ length: 500 }, () => `|${'x|'.repeat(50)}`).join('\n'));
  expect(d.querySelectorAll('tbody tr').length).toBeLessThanOrEqual(200);
  expect(d.querySelectorAll('th').length).toBeLessThanOrEqual(20);
  expect(performance.now() - t).toBeLessThan(5000);
});

test('a heading keeps its text, loses closing hashes, and a long one is still a heading', () => {
  expect(html('## Title ##  ').querySelector('.gy-md-h')!.textContent).toBe('Title');
  expect(html('# C# language').querySelector('.gy-md-h')!.textContent).toBe('C# language');
  expect(html(`# ${'x'.repeat(500)}`).querySelector('.gy-md-h')!.textContent).toHaveLength(500);
});

test('a long run of backslash escapes renders as one text node', () => {
  const paragraph = html('\\'.repeat(8000)).querySelector('p')!;
  expect(paragraph.textContent).toBe('\\'.repeat(4000));
  expect(paragraph.childNodes).toHaveLength(1);
});

// Each line is 20k characters of one run that every pattern could split many ways; linear parsing takes a few ms.
test.each([
  ['a heading with a long blank run', `#${' '.repeat(8000)}x${' '.repeat(8000)}#`],
  ['a heading with a long blank run and a long tail', `#${' '.repeat(8000)}${'x'.repeat(8000)}`],
  ['a table row of pipes', `${'|'.repeat(8000)}\n${'|-'.repeat(4000)}\n${'|'.repeat(8000)}`],
  ['a list marker and blanks', `-${' '.repeat(8000)}`],
  ['blank lines', `a${'\n '.repeat(8000)}b`],
])('%s parses in well under 100 ms', (_n, text) => {
  html('warm up');
  const t = performance.now();
  html(text);
  expect(performance.now() - t).toBeLessThan(100);
});
