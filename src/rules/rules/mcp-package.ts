import { quote } from '../mask.ts';
import type { ProjectHit, Rule } from '../types.ts';

export const mcpPackage: Rule = {
  id: 'mcp-package',
  title: 'MCP server package refused by depcurfew',
  level: 'high',
  owasp: ['AST02'],
  description:
    'When depcurfew is installed and the project has depcurfew.json, checks the package that an MCP server starts through npx, uvx and the like with depcurfew, offline: a source the policy forbids (a git repository, a tarball URL, a local folder) or a spec that is not one. An error of depcurfew is high, a warning medium. The checks that need the registry (release age, existence, install scripts, similar names, known malicious versions) are not made, since agentcurfew uses no network; run npx depcurfew check <package> for those.',
  levels: 'high for a depcurfew error, medium for a depcurfew warning',
  fix: 'Follow the fix depcurfew gives in the message, or start the server from a package source depcurfew.json allows.',
  example: '"command": "npx", "args": ["-y", "github:someone/mcp-server"], with sources.git deny in depcurfew.json',
  kinds: [],
  check: () => [],
  checkProject(inventory, context) {
    const reports = context.packageReports;
    if (reports === undefined) return [];
    const hits: ProjectHit[] = [];
    for (const component of inventory.components) {
      if (component.kind !== 'mcp-server') continue;
      const report = reports.get(`${component.file}\0${component.name}`);
      for (const finding of report?.findings ?? []) {
        hits.push({
          kind: component.kind,
          file: component.file,
          name: component.name,
          level: finding.level === 'error' ? 'high' : 'medium',
          message: `depcurfew (${finding.code}) on ${quote(report?.spec ?? '', 80)}: ${quote(finding.message, 200)}; ${quote(finding.fix, 200)}`,
        });
      }
    }
    return hits;
  },
};
