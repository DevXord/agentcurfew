import { verifiedOn } from './define.ts';
import type { CliOption, SharedKnowledge } from './types.ts';

const { verified } = verifiedOn('2026-11-06');
// Facts about tools, read for the hook of 1.2.1 (Q-030: they live here, with sources, like facts about agents).
const tools = verifiedOn('2026-11-11');

const SPECIFICATION = 'https://agentskills.io/specification';

// Tag v1.7.6, the gitHead of skills@1.7.6, the latest version on npm on 2026-11-06.
const SKILLS_V1_7_6 = 'https://github.com/vercel-labs/skills/blob/7a5e920bead4b1039a6d6df5d7e1163b7b09423a/src';

const SKILLS_DOCS = 'https://raw.githubusercontent.com/vercel-labs/skills/main/docs/commands.md';
// The package skills@1.8.1, the latest version on npm on 2026-11-11.
const SKILLS_V1_8_1 = 'https://registry.npmjs.org/skills/-/skills-1.8.1.tgz';
const POWERSHELL_DOCS = 'https://raw.githubusercontent.com/MicrosoftDocs/PowerShell-Docs/main/reference';
const PNPM_PNX = 'https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/cli/pnx.md';
const NPM_CMD_LIST = 'https://raw.githubusercontent.com/npm/cli/latest/lib/utils/cmd-list.js';

export const shared: SharedKnowledge = {
  skillFormat: verified(
    {
      entryFile: 'SKILL.md',
      requiredFields: ['name', 'description'],
      optionalFields: ['license', 'compatibility', 'metadata', 'allowed-tools'],
      bundledDirectories: ['scripts', 'references', 'assets'],
    },
    SPECIFICATION,
    'The bundled directories are conventions: a skill may hold any other files and directories, so they do not bound where executable code can be. allowed-tools is a space-separated string, marked experimental, and support varies between agents. name must match the parent directory.',
  ),
  skillsLock: verified(
    {
      file: 'skills-lock.json',
      versionField: 'version',
      skillsField: 'skills',
      entryFields: ['source', 'sourceUrl', 'ref', 'sourceType', 'skillPath', 'version', 'via', 'computedHash', 'subagents', 'wellKnownDigest', 'installMode'],
      hashField: 'computedHash',
      hashAlgorithm:
        'SHA-256, lowercase hex digest. Walk the folder recursively, skipping directories named .git or node_modules at any depth and every entry that is neither a directory nor a regular file, so symlinks are skipped. Each file path is relative to the skill folder with / separators. Sort by path with String.prototype.localeCompare and no locale argument. For each file in that order, feed the hash the UTF-8 bytes of the path, then the raw bytes of the content, with no separator or length prefix.',
    },
    `${SKILLS_V1_7_6}/local-lock.ts`,
    [
      'The file holds version 1 (other versions are refused) and a map of skill name to entry, sorted by name, written as JSON with 2-space indent and a final newline. source, sourceType and computedHash are required in an entry. experimental_install, which restores from this file, still carries the experimental name in v1.7.6.',
      `Hashing the installed folder does not always reproduce computedHash. Except for well-known sources, the hash is taken at the source, not from the installed copy (sourceSkillHash in ${SKILLS_V1_7_6}/add.ts), while the copy drops files named metadata.json, directories named __pycache__ or __pypackages__ and dereferences symlinks (copyDirectory in ${SKILLS_V1_7_6}/installer.ts). A skill with any of those can show a false mismatch.`,
      `Skills installed from a blob snapshot use computeSnapshotHash (${SKILLS_V1_7_6}/blob.ts): the same scheme over the snapshot's file list, whose contents are strings, and for a skill at the repository root only its SKILL.md. The default-locale sort can order paths differently between machines. The user-level lock is a different file (skill-lock.ts), whose skillFolderHash may be a GitHub tree SHA.`,
    ].join(' '),
  ),
  skillsInstaller: tools.verified(
    {
      packageName: 'skills',
      addCommand: 'add',
      valueOptions: ['-a', '--agent', '-s', '--skill', '--subagent', '--metadata'],
      binaries: ['skills', 'add-skill'],
      addAliases: ['a', 'install', 'i'],
      restoreWithoutSource: ['install', 'i'],
      useCommand: 'use',
      changeCommands: ['experimental_install', 'update', 'upgrade', 'sync', 'experimental_sync', 'remove', 'rm', 'r', 'init'],
      addOptions: {
        global: { type: 'boolean', short: 'g' },
        yes: { type: 'boolean', short: 'y' },
        list: { type: 'boolean', short: 'l' },
        all: { type: 'boolean' },
        agent: { type: 'list', short: 'a' },
        skill: { type: 'list', short: 's' },
        metadata: { type: 'string' },
        'full-depth': { type: 'boolean' },
        json: { type: 'boolean' },
        copy: { type: 'boolean' },
        subagent: { type: 'list' },
      } satisfies Record<string, CliOption>,
      useOptions: {
        help: { type: 'boolean', short: 'h' },
        'full-depth': { type: 'boolean' },
        skill: { type: 'string', short: 's' },
        agent: { type: 'list', short: 'a' },
      } satisfies Record<string, CliOption>,
    },
    SKILLS_DOCS,
    `npx skills add <source>, where the source is owner/repo, owner/repo@ref, a GitHub or GitLab URL, any git URL or a local path. Read again on 2026-11-11 in skills@1.8.1 (${SKILLS_V1_8_1}: bin, dist/cli.mjs, dist/_chunks/remove.mjs): the bins skills and add-skill run the same CLI; i, install, a and add take every positional word as a source (parseAddOptions returns source: positionals), and i or install without one restore from the lock; use resolves sources as add does and hands the skill to an agent; experimental_install, update/upgrade, sync/experimental_sync, remove/rm/r and init change installed skills; find/search/f/s, list/ls and check only read. Options are parsed with node:util parseArgs (strict: false), and a list option takes the positional words after it until the next option. Claude Code skills go to .claude/skills or ~/.claude/skills (docs/agents.md).`,
  ),
  powershell: tools.verified(
    {
      escape: '`',
      readOnlyCommands: [
        'get-content', 'gc', 'type', 'cat', 'select-string', 'sls', 'test-path', 'get-childitem', 'gci', 'dir', 'ls', 'get-item', 'gi', 'resolve-path', 'rvpa', 'get-location', 'gl', 'pwd',
        'set-location', 'sl', 'cd', 'chdir', 'push-location', 'pushd', 'pop-location', 'popd', 'write-output', 'write', 'echo',
      ],
    },
    `${POWERSHELL_DOCS}/docs-conceptual/learn/shell/using-aliases.md`,
    `Aliases from the alias sections of the cmdlet pages (${POWERSHELL_DOCS}/7.5/Microsoft.PowerShell.Management/Get-Content.md and the pages of Get-ChildItem, Get-Item, Resolve-Path, Set-Location, Push-Location, Test-Path; Microsoft.PowerShell.Utility/Select-String.md); cat and ls are Windows-only aliases, which PowerShell on Linux and macOS leaves to the native programs. The backtick is "the PowerShell escape character", a single quote is written twice inside single quotes, and nothing gives a backslash a meaning (${POWERSHELL_DOCS}/7.5/Microsoft.PowerShell.Core/About/about_Quoting_Rules.md, about_Parsing.md), so .claude\\settings.json is a path.`,
  ),
  packageAliases: tools.verified(
    { aliases: { pnx: ['pnpm', 'dlx'], pn: ['pnpm'] }, platformOptions: ['--cpu', '--os', '--libc'], shellModeOptions: ['-c', '--shell-mode'] },
    PNPM_PNX,
    'pnx has the aliases "pnpm dlx" and pnpx; "pn is available as a short alias for pnpm, and pnx as a short alias for pnpm dlx" (https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/pnpm-cli.md); the pnpm package installs the bins pn, pnx, pnpm and pnpx (registry.npmjs.org, pnpm 12.18.0). --cpu, --os and --libc take values ("pnx --cpu arm64,x64 --os linux some-cli"); npm reads the same three options (npm/cli workspaces/config/lib/definitions/definitions.js). -c/--shell-mode "Runs the command inside of a shell".',
  ),
  packageRemoval: tools.verified(
    {
      commands: { npm: ['uninstall', 'unlink', 'remove', 'rm', 'r', 'un'], pnpm: ['remove', 'rm', 'uninstall', 'un', 'uni'], yarn: ['remove'], bun: ['remove', 'rm', 'uninstall', 'r'] },
      abbreviates: ['npm'],
    },
    NPM_CMD_LIST,
    'The aliases of npm uninstall are unlink, remove, rm, r and un, and deref takes any unique abbreviation of a command or alias (abbrev). pnpm remove: "Aliases: rm, uninstall, un, uni" (https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/cli/remove.md). bun remove: "Alias — bun rm, bun uninstall, bun r" (https://raw.githubusercontent.com/oven-sh/bun/main/docs/pm/cli/remove.mdx). Yarn: remove (https://raw.githubusercontent.com/yarnpkg/berry/master/packages/plugin-essentials/sources/commands/remove.ts).',
  ),
  chdirOptions: tools.verified(
    { options: { env: ['-C', '--chdir'], sudo: ['-D', '--chdir'] } },
    'https://raw.githubusercontent.com/coreutils/coreutils/master/doc/coreutils.texi',
    'env -C dir / --chdir=dir: "Change the working directory to dir before invoking command". sudo -D directory / --chdir=directory: "Run the command in the specified directory" (https://raw.githubusercontent.com/sudo-project/sudo/main/docs/sudo.man.in).',
  ),
  depcurfew: tools.verified(
    { entryFiles: ['node_modules/depcurfew/dist/cli.js', '.claude/depcurfew/node_modules/depcurfew/dist/cli.js'], writingCommands: ['init', 'apply'] },
    'https://github.com/DevXord/depcurfew/blob/v1.6.0/README.md',
    'The hook runs node ${CLAUDE_PROJECT_DIR}/node_modules/depcurfew/dist/cli.js check --hook claude-code; "A repository without package.json in its root" keeps depcurfew in .claude/depcurfew/ and points the hook at ${CLAUDE_PROJECT_DIR}/.claude/depcurfew/node_modules/depcurfew/dist/cli.js. Of its commands, init writes depcurfew.json and apply writes the configuration of the tools; check, explain, doctor, mcp and osv update read the project (osv update writes depcurfew\'s own cache).',
  ),
};
