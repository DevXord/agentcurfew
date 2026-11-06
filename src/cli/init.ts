import { existsSync, lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanInventory } from '../inventory/index.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { readSkillsLock } from '../lock/skills-lock.ts';
import { proposePolicy, serializePolicy } from '../policy/init.ts';
import { POLICY_FILE } from '../policy/types.ts';
import { runRules } from '../rules/index.ts';
import { parseCommand } from './commands.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { projectRoot } from './project.ts';

export function runInit(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { values, positionals } = parseCommand('init', argv);
  const root = projectRoot(positionals, io, usageError, 'init');
  if (typeof root === 'number') return root;
  const path = join(root, POLICY_FILE);
  let link = false;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    link = false;
  }
  if (values.print !== true && (link || (existsSync(path) && values.force !== true))) {
    const why = link ? 'is a link, so it was not written' : 'already exists, so it was left as it is';
    const fix = link ? 'replace the link with a regular file, or delete it' : 'edit it, or run agentcurfew init --print to see a proposal, or --force to replace it';
    io.stderr(`agentcurfew: ${POLICY_FILE} ${why}\n  in: ${POLICY_FILE}\n  fix: ${fix}\n`);
    return EXIT_FAILURE;
  }
  // The proposal is made from the project as it is, without the policy that may already be there.
  const inventory = scanInventory({ root });
  const skillsLock = readSkillsLock(root);
  const findings = runRules(inventory, { context: { knowledge: knowledgeBase, skillsLock } });
  const { policy, loosened } = proposePolicy(inventory, findings, skillsLock, knowledgeBase);
  const text = serializePolicy(policy);
  if (values.print === true) {
    io.stdout(text);
    return EXIT_OK;
  }
  writeFileSync(path, text);
  const lines = [`Wrote ${POLICY_FILE}: it allows the skill sources and MCP servers the project has now.`];
  if (loosened.length > 0) lines.push('Left loose, because the project does not meet the strict value yet; tighten each once it does:', ...loosened.map((item) => `  ${item}`));
  lines.push('Review the file and commit it. agentcurfew doctor checks it.');
  io.stdout(`${lines.join('\n')}\n`);
  return EXIT_OK;
}
