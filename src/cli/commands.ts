import { parseArgs } from 'node:util';
import { getVersion } from '../version.ts';

export interface OptionSpec {
  name: string;
  type: 'boolean' | 'string';
  short?: string;
  /** The option can be given more than once. */
  multiple?: boolean;
  /** The value's placeholder in help, for string options. */
  value?: string;
  description: string;
}

export interface CommandSpec {
  name: string;
  /** One line, for the command list. */
  summary: string;
  usage: string;
  description: string;
  options: readonly OptionSpec[];
  /** Command lines without the program name; a test runs each one on an empty project. */
  examples: readonly string[];
  /** Shown on the welcome screen. */
  common?: boolean;
}

const JSON_OPTION: OptionSpec = { name: 'json', type: 'boolean', description: 'Print JSON (see docs/cli-json.md); file contents and secrets are left out' };

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'scan',
    summary: 'Check what steers agents in a project against the rules',
    usage: 'scan [directory] [options]',
    description:
      'Reads the skills, MCP servers, hooks, context files and permissions of a project, as the knowledge base describes them for each agent, and checks them against the rules. Nothing found is run, and nothing is sent anywhere. Exits with 1 when a finding is at --fail-on or above.',
    options: [
      { name: 'fail-on', type: 'string', value: 'level', description: 'Exit with 1 at this level or above: critical, high (default), medium, low, none' },
      JSON_OPTION,
      { name: 'sarif', type: 'boolean', description: 'Print SARIF 2.1.0, for GitHub Code Scanning and other tools' },
      { name: 'inventory', type: 'boolean', description: 'Only list the components, without the rules' },
      { name: 'user', type: 'boolean', description: 'Also read your home directory and machine settings' },
    ],
    examples: ['scan', 'scan --fail-on medium', 'scan --json', 'scan --sarif', 'scan --inventory'],
    common: true,
  },
  {
    name: 'lock',
    summary: 'Write agentcurfew.lock with a checksum of every component',
    usage: 'lock [directory]',
    description: 'Writes agentcurfew.lock: every component of the project with a checksum, MCP servers with their command and address (secrets redacted), skills with a checksum per file. Commit the file, and run verify in CI.',
    options: [],
    examples: ['lock'],
    common: true,
  },
  {
    name: 'verify',
    summary: 'Exit with 1 when a component changed since agentcurfew.lock',
    usage: 'verify [directory] [options]',
    description: 'Compares the project with agentcurfew.lock and lists what was added, removed or changed. Also compares skills with skills-lock.json, which never changes the result.',
    options: [JSON_OPTION],
    examples: ['verify', 'verify --json'],
    common: true,
  },
  {
    name: 'init',
    summary: 'Write agentcurfew.policy.json from what the project has now',
    usage: 'init [directory] [options]',
    description:
      'Proposes a policy that the project passes as it is: the skill sources and MCP servers it has now, and the strict value of each setting it already meets. Lists what it left loose. With --hook it adds the agentcurfew hook for Claude Code to .claude/settings.json instead, keeping every other hook, such as depcurfew\'s.',
    options: [
      { name: 'print', type: 'boolean', description: 'Print the result instead of writing it' },
      { name: 'force', type: 'boolean', description: 'Replace an existing policy' },
      { name: 'hook', type: 'boolean', description: 'Add the agentcurfew hook to .claude/settings.json instead, next to any other hook' },
    ],
    examples: ['init --print', 'init', 'init --hook --print'],
  },
  {
    name: 'doctor',
    summary: 'Find configuration that agents ignore or that does not work',
    usage: 'doctor [directory] [options]',
    description: 'Finds files with a name or key that agents do not read, settings that another file overrides, deprecated formats, and problems of the policy. Every finding names its source.',
    options: [
      { name: 'fail-on', type: 'string', value: 'level', description: 'Exit with 1 at this level or above: error, warning (default), info, none' },
      JSON_OPTION,
      { name: 'user', type: 'boolean', description: 'Also read your home directory and machine settings' },
    ],
    examples: ['doctor', 'doctor --fail-on error', 'doctor --json'],
    common: true,
  },
  {
    name: 'mcp',
    summary: 'Serve read-only checks to an agent over MCP (stdio)',
    usage: 'mcp [options]',
    description:
      'Starts an MCP server on stdin and stdout with read-only tools: scan_project, check_skill (a skill folder before it is installed), check_mcp_config (a server definition before it is added) and explain_rule. It reads files only inside the folder it is started in, the folders given with --root and the roots the client shares. Speaks MCP 2026-07-28 and 2025-11-25.',
    options: [{ name: 'root', type: 'string', value: 'folder', multiple: true, description: 'Another folder the tools may read; repeat for more' }],
    examples: ['mcp'],
  },
  {
    name: 'hook',
    summary: 'Check a tool call of Claude Code before it runs (used as a hook)',
    usage: 'hook < input.json',
    description:
      'Reads the PreToolUse input of Claude Code on stdin. Writes to files that steer agents ask first, and are denied when the new text has a finding at high or above or breaks the policy; adding a skill or an MCP server is denied when the policy does not allow it. Prints nothing for every other call, so it never allows anything by itself. Install it with agentcurfew init --hook.',
    options: [],
    examples: ['hook'],
  },
  {
    name: 'explain',
    summary: 'Say what a rule finds, why it matters and how to fix it',
    usage: 'explain <rule>',
    description: 'Prints the description, the OWASP Agentic Skills Top 10 references, an example and the fix of a rule. The rules are listed in docs/rules.md.',
    options: [],
    examples: ['explain hidden-unicode', 'explain unpinned-mcp-server'],
  },
  {
    name: 'help',
    summary: 'Show every command, or the help of one',
    usage: 'help [command]',
    description: 'Without a command, lists every command. With one, shows its options and examples.',
    options: [],
    examples: ['help', 'help scan'],
  },
];

const HELP_OPTION: OptionSpec = { name: 'help', type: 'boolean', short: 'h', description: 'Show this help' };

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}

/** The parseArgs options of a command, from the same table as its help, so the two cannot differ. */
export function parseCommand(name: string, argv: readonly string[]): { values: Record<string, string | boolean | string[] | boolean[] | undefined>; positionals: string[] } {
  const spec = findCommand(name);
  if (spec === undefined) throw new Error(`no such command: ${name}`);
  const options: Record<string, { type: 'boolean' | 'string'; short?: string; multiple?: boolean }> = {};
  for (const option of [...spec.options, HELP_OPTION]) {
    options[option.name] = { type: option.type, ...(option.short === undefined ? {} : { short: option.short }), ...(option.multiple === true ? { multiple: true } : {}) };
  }
  const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, options });
  return { values: values as Record<string, string | boolean | string[] | boolean[] | undefined>, positionals };
}

function optionLine(option: OptionSpec): [string, string] {
  const flag = `${option.short === undefined ? '' : `-${option.short}, `}--${option.name}${option.value === undefined ? '' : ` <${option.value}>`}`;
  return [flag, option.description];
}

function table(rows: readonly [string, string][], indent = '  '): string[] {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `${indent}${left.padEnd(width)}  ${right}`);
}

/** The screen of agentcurfew with no arguments: what it is and the commands most people need. */
export function welcomeText(): string {
  const common = COMMANDS.filter((command) => command.common === true);
  return [
    `agentcurfew ${getVersion()}: inventory, lock and check what steers your AI coding agents.`,
    '',
    'Common commands:',
    ...table(common.map((command) => [`agentcurfew ${command.name}`, command.summary])),
    '',
    'Run agentcurfew help to see every command, or agentcurfew help <command> for one.',
    '',
  ].join('\n');
}

/** agentcurfew help: every command and the global options. */
export function helpText(): string {
  return [
    'agentcurfew: inventory, lock and check what steers your AI coding agents.',
    '',
    'Usage: agentcurfew <command> [options]',
    '',
    'Commands:',
    ...table(COMMANDS.map((command) => [command.name, command.summary])),
    '',
    'Options:',
    ...table([
      ['-h, --help', 'Show help; agentcurfew <command> --help shows the help of a command'],
      ['-v, --version', 'Show the version'],
    ]),
    '',
    'Run agentcurfew help <command> for the options and examples of a command.',
    '',
  ].join('\n');
}

/** agentcurfew help <command> and agentcurfew <command> --help. */
export function commandHelpText(spec: CommandSpec): string {
  const lines = [`agentcurfew ${spec.name}: ${spec.summary}`, '', `Usage: agentcurfew ${spec.usage}`, '', spec.description, ''];
  const options = [...spec.options, HELP_OPTION];
  lines.push('Options:', ...table(options.map(optionLine)), '');
  lines.push('Examples:', ...spec.examples.map((example) => `  agentcurfew ${example}`), '');
  return lines.join('\n');
}
