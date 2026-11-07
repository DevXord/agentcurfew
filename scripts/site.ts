// Builds the documentation site into dist-site/ (or the folder given as the first argument) from README.md, the pages of
// docs/ meant for users and CHANGELOG.md, so that the site says what they say. Its pages link to each other with
// relative links, need no JavaScript and load nothing from other hosts. Modelled on depcurfew's site.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeBase } from '../src/knowledge/index.ts';

const ROOT = new URL('../', import.meta.url);
const REPOSITORY = 'https://github.com/DevXord/agentcurfew';
const NPM = 'https://www.npmjs.com/package/agentcurfew';

interface Page {
  source: string;
  file: string;
  /** The name in the navigation and in the title. */
  label: string;
  group: 'Start' | 'Reference' | 'Integrations' | 'Project';
  description: string;
}

export const PAGES: readonly Page[] = [
  {
    source: 'README.md',
    file: 'index.html',
    label: 'Overview',
    group: 'Start',
    description:
      'One local, account-less security policy for the files that steer AI coding agents: skills, MCP servers, hooks, context files and permissions.',
  },
  {
    source: 'docs/rules.md',
    file: 'rules.html',
    label: 'Rules',
    group: 'Reference',
    description: 'What each rule of agentcurfew scan finds, its level, its OWASP Agentic Skills Top 10 reference and how to fix it.',
  },
  {
    source: 'docs/policy.md',
    file: 'policy.html',
    label: 'Policy',
    group: 'Reference',
    description: 'The fields of agentcurfew.policy.json: allowed skill sources and MCP servers, pinned versions, levels and exceptions.',
  },
  {
    source: 'docs/doctor.md',
    file: 'doctor.html',
    label: 'doctor checks',
    group: 'Reference',
    description: 'The checks of agentcurfew doctor: configuration that AI coding agents ignore or that does not do what it seems to.',
  },
  {
    source: 'docs/cli-json.md',
    file: 'cli-json.html',
    label: 'JSON and SARIF',
    group: 'Reference',
    description: 'The JSON and SARIF output of agentcurfew scan, verify and doctor.',
  },
  {
    source: 'docs/knowledge.md',
    file: 'knowledge.html',
    label: 'Knowledge base',
    group: 'Reference',
    description: 'Where each AI coding agent reads its skills, MCP servers, hooks, context files and permissions, with sources and dates.',
  },
  {
    source: 'docs/mcp.md',
    file: 'mcp.html',
    label: 'MCP server and hook',
    group: 'Integrations',
    description: 'The read-only MCP server of agentcurfew and its Claude Code hook that stops dangerous writes to agent files.',
  },
  {
    source: 'CHANGELOG.md',
    file: 'changelog.html',
    label: 'Changes',
    group: 'Project',
    description: 'The changes of each release of agentcurfew.',
  },
];

const GROUPS = ['Start', 'Reference', 'Integrations', 'Project'] as const;

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** The text of inline Markdown without its marks, for anchors and the title. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/<[^>]*>/g, '');
}

/** Where a link of a Markdown file points on the site: a page of it, or the file in the repository. */
function href(target: string, source: string): string {
  if (/^(?:https?:|mailto:)/.test(target) || target.startsWith('#')) return target;
  const [path = '', hash] = target.split('#', 2);
  const resolved = posix.normalize(posix.join(posix.dirname(source), path));
  const page = PAGES.find((candidate) => candidate.source === resolved);
  const suffix = hash === undefined ? '' : `#${hash}`;
  if (page !== undefined) return `${page.file}${suffix}`;
  return `${REPOSITORY}/blob/main/${resolved}${suffix}`;
}

const LEVEL = /^(critical|high|medium|low|info|error|warning)(\*?)$/;

function inline(text: string, source: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const code = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
    if (code !== null) {
      out += `<code>${escape((code[2] ?? '').replace(/^ (.*\S.*) $/, '$1'))}</code>`;
      index += code[0].length;
      continue;
    }
    const auto = /^<(https?:\/\/[^\s>]+)>/.exec(rest);
    if (auto !== null) {
      out += `<a href="${escape(auto[1] ?? '')}">${escape(auto[1] ?? '')}</a>`;
      index += auto[0].length;
      continue;
    }
    const link = /^\[((?:`[^`]*`|[^\]])*)\]\(([^)\s]+)\)/.exec(rest);
    if (link !== null) {
      out += `<a href="${escape(href(link[2] ?? '', source))}">${inline(link[1] ?? '', source)}</a>`;
      index += link[0].length;
      continue;
    }
    const strong = /^\*\*(.+?)\*\*/.exec(rest);
    if (strong !== null) {
      out += `<strong>${inline(strong[1] ?? '', source)}</strong>`;
      index += strong[0].length;
      continue;
    }
    if (rest.startsWith('<br>')) {
      out += '<br>';
      index += 4;
      continue;
    }
    if (rest.startsWith('\\') && /^\\[\\`*_[\]()#|<>-]/.test(rest)) {
      out += escape(rest[1] ?? '');
      index += 2;
      continue;
    }
    out += escape(rest[0] ?? '');
    index += 1;
  }
  return out;
}

/** The cells of a table row, split on pipes outside code spans. */
function cells(line: string): string[] {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let cell = '';
  let ticks = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index] ?? '';
    if (char === '\\' && row[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (char === '`') {
      ticks = !ticks;
      cell += char;
    } else if (char === '|' && !ticks) {
      out.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  out.push(cell.trim());
  return out;
}

function cell(text: string, source: string, tag: 'th' | 'td', align: string | undefined): string {
  const level = LEVEL.exec(text);
  const body =
    tag === 'td' && level !== null
      ? `<span class="with-level"><span class="level level-${level[1]}">${level[1]}</span>${level[2] ?? ''}</span>`
      : inline(text, source);
  return `<${tag}${align === undefined ? '' : ` class="align-${align}"`}>${body}</${tag}>`;
}

export interface Heading {
  level: number;
  id: string;
  html: string;
}

interface Rendered {
  html: string;
  headings: Heading[];
  title: string | undefined;
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const BLOCK_START = /^(?:#{1,6}\s|```|>|\||<!--)/;

/** A Markdown subset: the one README.md, docs/ and CHANGELOG.md are written in. */
export function markdown(text: string, source: string): Rendered {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  let title: string | undefined;
  const out: string[] = [];

  const anchor = (raw: string): string => {
    const base = slug(plain(raw));
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  function list(start: number, indent: number): number {
    const first = LIST_ITEM.exec(lines[start] ?? '');
    const ordered = first !== null && /\d/.test(first[2] ?? '');
    out.push(ordered ? '<ol>' : '<ul>');
    let index = start;
    let open = false;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      const item = LIST_ITEM.exec(line);
      if (line.trim() === '') {
        const next = lines[index + 1] ?? '';
        const nextItem = LIST_ITEM.exec(next);
        if (nextItem !== null && (nextItem[1] ?? '').length >= indent) {
          index += 1;
          continue;
        }
        break;
      }
      if (item !== null) {
        const depth = (item[1] ?? '').length;
        if (depth < indent) break;
        if (depth > indent) {
          index = list(index, depth);
          continue;
        }
        if (open) out.push('</li>');
        out.push(`<li>${inline(item[3] ?? '', source)}`);
        open = true;
        index += 1;
        continue;
      }
      if (/^\s+\S/.test(line) && open) {
        out[out.length - 1] += ` ${inline(line.trim(), source)}`;
        index += 1;
        continue;
      }
      break;
    }
    if (open) out.push('</li>');
    out.push(ordered ? '</ol>' : '</ul>');
    return index;
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith('<!--')) {
      while (index < lines.length && !(lines[index] ?? '').includes('-->')) index += 1;
      index += 1;
      continue;
    }
    const fence = /^```(\S*)/.exec(line);
    if (fence !== null) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      const language = fence[1] === '' || fence[1] === undefined ? '' : ` class="language-${escape(fence[1])}"`;
      out.push(`<pre><code${language}>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? '').length;
      const raw = heading[2] ?? '';
      const id = anchor(raw);
      const html = inline(raw, source);
      if (level === 1 && title === undefined) title = plain(raw);
      if (level === 2 || level === 3) headings.push({ level, id, html });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const head = cells(line);
      const aligns = cells(lines[index + 1] ?? '').map((spec) => {
        if (spec.startsWith(':') && spec.endsWith(':')) return 'center';
        if (spec.endsWith(':')) return 'right';
        if (spec.startsWith(':')) return 'left';
        return undefined;
      });
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('|')) {
        const row = cells(lines[index] ?? '');
        rows.push(`<tr>${row.map((text, column) => cell(text, source, 'td', aligns[column])).join('')}</tr>`);
        index += 1;
      }
      const wide = head.length >= 5 ? ' wide' : '';
      out.push(
        `<div class="table${wide}" tabindex="0"><table><thead><tr>${head
          .map((text, column) => cell(text, source, 'th', aligns[column]))
          .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        body.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote><p>${inline(body.join(' '), source)}</p></blockquote>`);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      index = list(index, (LIST_ITEM.exec(line)?.[1] ?? '').length);
      continue;
    }
    const body: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (next.trim() === '' || BLOCK_START.test(next) || (body.length > 0 && LIST_ITEM.test(next))) break;
      body.push(next.trim());
      index += 1;
    }
    out.push(`<p>${inline(body.join(' '), source)}</p>`);
  }
  return { html: out.join('\n'), headings, title };
}

function toc(headings: readonly Heading[]): string {
  if (headings.length === 0) return '';
  const items: string[] = [];
  let nested = false;
  for (const heading of headings) {
    const link = `<a href="#${heading.id}">${heading.html.replace(/<a [^>]*>|<\/a>/g, '')}</a>`;
    if (heading.level === 3) {
      if (!nested) {
        if (items.length === 0) items.push('<li>');
        else items[items.length - 1] = (items[items.length - 1] ?? '').replace(/<\/li>$/, '');
        items.push('<ul>');
        nested = true;
      }
      items.push(`<li>${link}</li>`);
      continue;
    }
    if (nested) {
      items.push('</ul></li>');
      nested = false;
    }
    items.push(`<li>${link}</li>`);
  }
  if (nested) items.push('</ul></li>');
  return `<details class="toc-toggle"><summary>On this page</summary></details>
<nav class="toc" aria-label="On this page">
<p class="toc-title">On this page</p>
<ul>
${items.join('\n')}
</ul>
</nav>`;
}

function navigation(current: Page | undefined): string {
  const groups = GROUPS.map((group) => {
    const links = PAGES.filter((page) => page.group === group).map(
      (page) => `<li><a href="${page.file}"${page === current ? ' aria-current="page"' : ''}>${escape(page.label)}</a></li>`,
    );
    if (group === 'Project') links.push(`<li><a href="${REPOSITORY}">GitHub</a></li>`, `<li><a href="${NPM}">npm</a></li>`);
    return `<div class="group">
<p class="group-title">${group}</p>
<ul>
${links.join('\n')}
</ul>
</div>`;
  });
  return `<nav class="pages" aria-label="Pages">
<details class="menu"><summary>Menu</summary></details>
<div class="groups">
${groups.join('\n')}
</div>
</nav>`;
}

function document(options: { title: string; description: string; version: string; current: Page | undefined; main: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(options.title)}</title>
<meta name="description" content="${escape(options.description)}">
<link rel="stylesheet" href="style.css">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="agentcurfew">
<meta property="og:title" content="${escape(options.title)}">
<meta property="og:description" content="${escape(options.description)}">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="site">
<a class="brand" href="index.html"><img src="favicon.svg" alt="" width="20" height="20">agentcurfew</a>
<span class="version">v${escape(options.version)}</span>
</header>
${navigation(options.current)}
<main id="content">
${options.main}
</main>
<footer class="site"><p>agentcurfew ${escape(options.version)} · MIT license · built from the <a href="${REPOSITORY}">repository</a>'s README and docs · a sibling of <a href="https://depcurfew.github.io/">depcurfew</a></p></footer>
</body>
</html>
`;
}

/** The start page: a hero in place of the README's title and summary, and cards of the other pages at the end. */
function hero(summary: string): string {
  const chips = knowledgeBase
    .map((agent) => `<li><a href="knowledge.html#${slug(agent.name)}">${escape(agent.name)}</a></li>`)
    .join('\n');
  return `<div class="hero">
<img class="logo" src="favicon.svg" alt="" width="96" height="96">
<h1 id="agentcurfew">agentcurfew</h1>
<p>${summary}</p>
<p class="actions">
<a class="button primary" href="#install">Install</a>
<a class="button" href="rules.html">Rules</a>
<a class="button" href="${REPOSITORY}">GitHub</a>
<a class="button" href="${NPM}">npm</a>
</p>
<ul class="chips" aria-label="Supported agents">
${chips}
</ul>
</div>`;
}

function cards(): string {
  const items = PAGES.filter((page) => page.file !== 'index.html').map(
    (page) =>
      `<li><a href="${page.file}"><span class="title">${escape(page.label)}</span><span class="visually-hidden">: </span><span class="summary">${escape(page.description)}</span></a></li>`,
  );
  return `<h2 id="on-this-site">On this site</h2>
<ul class="cards">
${items.join('\n')}
</ul>`;
}

export function buildSite(outDir: string): string[] {
  const version = (JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as { version: string }).version;
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const page of PAGES) {
    let text = readFileSync(new URL(page.source, ROOT), 'utf8');
    let top = '';
    if (page.file === 'index.html') {
      // The title and the summary quote become the hero.
      const summary = /^> (.*)$/m.exec(text)?.[1] ?? page.description;
      text = text.replace(/^<img [^>]*>\n+/, '').replace(/^# .*\n+/m, '').replace(/^> .*\n+/m, '');
      top = hero(markdown(summary, page.source).html.replace(/^<p>|<\/p>$/g, ''));
    }
    const rendered = markdown(text, page.source);
    const extra = page.file === 'index.html' ? cards() : '';
    const headings = page.file === 'index.html' ? [...rendered.headings, { level: 2, id: 'on-this-site', html: 'On this site' }] : rendered.headings;
    const main = `${top}<div class="page">
${toc(headings)}
<div class="content">
${rendered.html}
${extra}
</div>
</div>`;
    const title = page.file === 'index.html' ? 'agentcurfew · Security policy for the files that steer AI coding agents' : `${page.label} · agentcurfew`;
    writeFileSync(`${outDir}/${page.file}`, document({ title, description: page.description, version, current: page, main }));
    written.push(page.file);
  }
  writeFileSync(
    `${outDir}/404.html`,
    document({
      title: 'Page not found · agentcurfew',
      description: 'This page does not exist.',
      version,
      current: undefined,
      main: '<div class="page"><div class="content"><h1 id="page-not-found">Page not found</h1><p>This page does not exist. Start at the <a href="index.html">overview</a>.</p></div></div>',
    }),
  );
  written.push('404.html');
  for (const asset of ['style.css', 'favicon.svg']) {
    copyFileSync(new URL(`site/${asset}`, ROOT), `${outDir}/${asset}`);
    written.push(asset);
  }
  writeFileSync(`${outDir}/.nojekyll`, '');
  return written;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = process.argv[2] ?? fileURLToPath(new URL('dist-site', ROOT));
  const written = buildSite(outDir);
  console.log(`Wrote ${written.length} files to ${outDir}`);
}
