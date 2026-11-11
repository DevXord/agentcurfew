import { redact } from '../../lock/redact.ts';
import { quote } from '../mask.ts';
import { launch, pinProblem } from '../launch.ts';
import { commandLine, mcpEntry } from '../mcp.ts';
import type { Rule, RuleHit } from '../types.ts';

export const unpinnedMcpServer: Rule = {
  id: 'unpinned-mcp-server',
  title: 'MCP server without a fixed version',
  level: 'medium',
  owasp: ['AST02', 'AST07'],
  description:
    'Finds MCP servers started through a launcher that downloads them at run time (npx, bunx, pnpm dlx, yarn dlx, npm exec and npm x, uvx, uv tool run, pipx run, docker run, podman run, also after their global options), and every package it fetches (each -p, uvx --with), that has no exact version or image digest. Each start may then run code that nobody reviewed, and the lockfile cannot pin it.',
  levels: 'low when the package could not be found in the launcher arguments',
  fix: 'Pin an exact version (npx -y package@1.2.3, uvx package==1.2.3) or an image digest (image@sha256:...). Check the package itself with depcurfew: npx depcurfew check <package>.',
  example: '"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"]',
  kinds: ['mcp-server'],
  check(component, context) {
    const entry = mcpEntry(component, context.knowledge);
    if (entry === undefined) return [];
    const started = launch(commandLine(entry));
    // npm exec --no and npx --no-install run only what is installed (field test of 2026-11-09).
    if (started === undefined || started.noDownload === true) return [];
    if (started.spec === undefined) return [{ message: `starts with ${started.family === 'docker' ? 'a container' : 'a package'} launcher, but the package could not be found in its arguments` , level: 'low' }];
    const what = started.family === 'docker' ? 'the image' : 'the package';
    const hits: RuleHit[] = [];
    // Every package the launcher fetches: npx -p a -p b and uvx --with a b fetch several (review of 2026-11-09).
    for (const spec of started.packages ?? [started.spec]) {
      const problem = pinProblem(started.family, spec);
      if (problem === undefined) continue;
      const check = started.family !== 'npm' ? '' : `; check it with npx depcurfew check ${quote(redact(spec), 80)}`;
      hits.push({ message: `${what} ${quote(redact(spec), 80)} ${problem}${check}` });
    }
    return hits;
  },
};
