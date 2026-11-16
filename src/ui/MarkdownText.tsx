import type { ReactNode } from 'react';
import { safeHref } from '../lib/sanitizeHtml';

/**
 * Inline code, [links](url), **bold**, *italics* and bare URLs. Built as React nodes, never HTML,
 * so nothing in the text can become markup. Every span is capped in length, so text full of
 * unclosed marks costs linear time; an asterisk inside a word (price*qty) is not a mark; a URL
 * may hold balanced parentheses.
 */
const INLINE = /\\([!-/:-@[-`{-~])|`([^`\n]{1,300})`|\[([^\]\n]{1,300})\]\(\s*((?:[^()\s]|\([^()\s]*\)){1,2000})\s*\)|\*\*(?!\s)(.{1,300}?)(?<!\s)\*\*|(?<![\w*])\*(?![\s*])([^*\n]{1,300}?)(?<!\s)\*(?![\w*])|(https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\)){1,2000})/g;

/** Punctuation that ends a sentence rather than a bare URL. */
const TRAIL = /[.,;:!?'"]+$/;

function link(href: string, text: ReactNode, key: number): ReactNode {
  if (!safeHref(href)) return text;
  return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{text}</a>;
}

/** `inLink` keeps a URL in a link's own label as text, so links never nest. */
function inline(text: string, inLink = false): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const [, esc, code, label, href, bold, em, url] = m;
    if (esc !== undefined) out.push(esc);
    else if (code !== undefined) out.push(<code key={at}>{code}</code>);
    else if (label !== undefined) out.push(inLink ? label : link(href!, inline(label, true), at));
    else if (bold !== undefined) out.push(<strong key={at}>{inline(bold, inLink)}</strong>);
    else if (em !== undefined) out.push(<em key={at}>{inline(em, inLink)}</em>);
    else {
      const bare = url!.replace(TRAIL, '');
      out.push(inLink ? bare : link(bare, bare, at), url!.slice(bare.length));
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const ITEM = /^\s*(?:[-*+]|(\d{1,9})[.)])\s+/;
// the groups are disjoint (hashes, blanks, then a non-blank), so the match is linear; the closing `#`s are cut by headingText
const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/;
const MAX_COLS = 20, MAX_ROWS = 200;

type Align = 'left' | 'center' | 'right' | undefined;
type Segment =
  | { kind: 'p'; lines: string[] }
  | { kind: 'list'; start: number | null; items: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'table'; head: string[]; align: Align[]; rows: string[][] };

/** A heading's text without its trailing blanks and optional closing hashes ("## Title ##"); a line of hashes alone stays as it is. */
function headingText(raw: string): string {
  let end = raw.length;
  while (end > 0 && /\s/.test(raw[end - 1]!)) end--;
  let cut = end;
  while (cut > 0 && raw[cut - 1] === '#') cut--;
  if (cut < end && cut > 0 && /\s/.test(raw[cut - 1]!)) {
    end = cut;
    while (end > 0 && /\s/.test(raw[end - 1]!)) end--;
  }
  return raw.slice(0, end);
}

/** A pipe-table line's cells: one leading and one trailing pipe are optional, `\|` stays in the cell. */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length) cur += c + s[++i];
    else if (c === '|') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const DELIM = /^:?-+:?$/;
const alignOf = (c: string): Align => (c.startsWith(':') ? (c.endsWith(':') ? 'center' : 'left') : c.endsWith(':') ? 'right' : undefined);

/** A block's lines as headings, tables, paragraphs and lists: an indented line after an item continues it. */
function segments(lines: string[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const cur = out[out.length - 1];
    const h = HEADING.exec(line);
    if (h) { out.push({ kind: 'h', level: h[1]!.length, text: headingText(h[2]!) }); continue; }
    const next = lines[i + 1];
    if (next !== undefined && line.includes('|') && next.includes('-')) {
      const head = cells(line), delim = cells(next);
      if (head.length === delim.length && delim.every((c) => DELIM.test(c))) {
        const rows: string[][] = [];
        let j = i + 2;
        for (; j < lines.length && lines[j]!.includes('|') && rows.length < MAX_ROWS; j++) rows.push(cells(lines[j]!));
        const n = Math.min(head.length, MAX_COLS);
        out.push({ kind: 'table', head: head.slice(0, n), align: delim.slice(0, n).map(alignOf), rows: rows.map((r) => Array.from({ length: n }, (_, k) => r[k] ?? '')) });
        i = j - 1;
        continue;
      }
    }
    const m = ITEM.exec(line);
    if (m) {
      const start = m[1] !== undefined ? Number(m[1]) : null;
      const item = line.slice(m[0].length);
      if (cur?.kind === 'list' && (cur.start === null) === (start === null)) cur.items.push(item);
      else out.push({ kind: 'list', start, items: [item] });
    } else if (cur?.kind === 'list' && /^\s/.test(line)) {
      cur.items[cur.items.length - 1] += ` ${line.trim()}`;
    } else if (cur?.kind === 'p') {
      cur.lines.push(line);
    } else {
      out.push({ kind: 'p', lines: [line] });
    }
  }
  return out;
}

/**
 * A description written in Markdown, rendered locally: paragraphs on blank lines, single line
 * breaks folded into spaces, headings (a small bold line), bullet and numbered lists, pipe tables,
 * backslash escapes and the inline marks above.
 */
export function MarkdownText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).flatMap((b) => segments(b.split('\n')));
  return (
    <>
      {blocks.map((s, i) => s.kind === 'p'
        ? <p key={i}>{inline(s.lines.map((l) => l.trim()).join(' '))}</p>
        : s.kind === 'h'
          ? <div key={i} className="gy-md-h" role="heading" aria-level={s.level}>{inline(s.text)}</div>
          : s.kind === 'table'
            ? <div key={i} className="gy-md-table"><table>
              <thead><tr>{s.head.map((c, k) => <th key={k} style={{ textAlign: s.align[k] }}>{inline(c)}</th>)}</tr></thead>
              <tbody>{s.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} style={{ textAlign: s.align[k] }}>{inline(c)}</td>)}</tr>)}</tbody>
            </table></div>
            : s.start === null
              ? <ul key={i}>{s.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
              : <ol key={i} start={s.start === 1 ? undefined : s.start}>{s.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>)}
    </>
  );
}
