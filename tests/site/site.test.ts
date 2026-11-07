import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGES, buildSite, markdown, slug } from '../../scripts/site.ts';

let dir = '';
const pages = new Map<string, string>();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentcurfew-site-'));
  buildSite(dir);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.html'))) pages.set(file, readFileSync(join(dir, file), 'utf8'));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ids = (html: string): Set<string> => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1] ?? ''));

describe('documentation site', () => {
  it('writes a page for every source, a 404 page and its assets', () => {
    for (const page of PAGES) expect(pages.has(page.file)).toBe(true);
    expect(pages.has('404.html')).toBe(true);
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(['style.css', 'favicon.svg']));
  });

  it('has no broken relative links or anchors', () => {
    const broken: string[] = [];
    for (const [file, html] of pages) {
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const target = match[1] ?? '';
        if (/^(?:https?:|mailto:)/.test(target) || target.endsWith('.css') || target.endsWith('.svg')) continue;
        const [path = '', hash] = target.split('#', 2);
        const page = path === '' ? file : path;
        const html2 = pages.get(page);
        if (html2 === undefined) broken.push(`${file}: ${target}`);
        else if (hash !== undefined && !ids(html2).has(hash)) broken.push(`${file}: ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('loads nothing from other hosts and runs no script', () => {
    for (const html of pages.values()) {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<(?:link|img)[^>]+(?:href|src)="https?:/i);
    }
    const css = readFileSync(join(dir, 'style.css'), 'utf8');
    expect(css).not.toMatch(/url\(|@import/);
  });

  it('escapes text from the sources', () => {
    const { html } = markdown('A `<script>` and <b>bold</b> & [link](docs/rules.md#drift).', 'README.md');
    expect(html).toBe('<p>A <code>&lt;script&gt;</code> and &lt;b&gt;bold&lt;/b&gt; &amp; <a href="rules.html#drift">link</a>.</p>');
  });

  it('links files that are not pages to the repository', () => {
    const { html } = markdown('[plan](PLAN.md) [license](../LICENSE)', 'docs/x.md');
    expect(html).toContain('href="https://github.com/DevXord/agentcurfew/blob/main/docs/PLAN.md"');
    expect(html).toContain('href="https://github.com/DevXord/agentcurfew/blob/main/LICENSE"');
  });

  it('makes anchors as GitHub does', () => {
    expect(slug('scan --json (version 3)')).toBe('scan---json-version-3');
    expect(slug('What agentcurfew does not find')).toBe('what-agentcurfew-does-not-find');
  });
});
