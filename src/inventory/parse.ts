import { parse as parseToml } from 'smol-toml';

const MAX_DEPTH = 64;

/** JSON with comments and trailing commas, which VS Code accepts in its files, as plain JSON. */
export function stripJsonc(text: string): string {
  let output = '';
  let comma = -1;
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (char === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      index++;
      output += text.slice(start, index);
      comma = -1;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      if ((char === '}' || char === ']') && comma !== -1) output = output.slice(0, comma) + output.slice(comma + 1);
      if (char === ',') comma = output.length;
      else if (char.trim() !== '') comma = -1;
      output += char;
      index++;
    }
  }
  return output;
}

function deeperThan(root: unknown, limit: number): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop() as { value: unknown; depth: number };
    if (typeof value !== 'object' || value === null) continue;
    if (depth >= limit) return true;
    for (const item of Object.values(value)) stack.push({ value: item, depth: depth + 1 });
  }
  return false;
}

/** The parsed file, or undefined when it cannot be read as its format. */
export function parseConfig(text: string, format: 'json' | 'toml'): unknown {
  const source = text.replace(/^﻿/, '');
  try {
    if (format === 'toml') return parseToml(source, { maxDepth: MAX_DEPTH, unsafeKeyBehaviour: 'keep', integersAsBigInt: 'asNeeded' });
    const value: unknown = JSON.parse(stripJsonc(source));
    return deeperThan(value, MAX_DEPTH) ? undefined : value;
  } catch {
    return undefined;
  }
}

/** JSON of a parsed entry; TOML integers too large for a number are written as text. */
export function entryText(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)) ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every value at a dotted path, with the path as found. A segment of * or <name> stands for any key. Keys may hold dots
 * themselves, as VS Code settings do, so "a.b.c" also matches a key written whole or in part.
 */
export function lookup(root: unknown, dotted: string): { path: string; value: unknown }[] {
  const found: { path: string; value: unknown }[] = [];
  const visit = (value: unknown, rest: readonly string[], path: string): void => {
    if (rest.length === 0) {
      found.push({ path, value });
      return;
    }
    if (!isRecord(value)) return;
    const [first] = rest as [string];
    if (first === '*' || first.startsWith('<')) {
      for (const key of Object.keys(value)) visit(value[key], rest.slice(1), path === '' ? key : `${path}.${key}`);
      return;
    }
    for (let length = 1; length <= rest.length; length++) {
      const key = rest.slice(0, length).join('.');
      if (Object.hasOwn(value, key)) visit(value[key], rest.slice(length), path === '' ? key : `${path}.${key}`);
    }
  };
  visit(root, dotted.split('.'), '');
  return found;
}
