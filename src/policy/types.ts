import type { Level } from '../rules/types.ts';

export const POLICY_FILE = 'agentcurfew.policy.json';
export const SCHEMA_URL = 'https://unpkg.com/agentcurfew/schema.json';

export type DoctorLevel = 'error' | 'warning' | 'info';

/** agentcurfew.policy.json, as schema.json describes it. */
export interface Policy {
  $schema?: string;
  version: 1;
  failOn?: Exclude<Level, 'info'> | 'none';
  skills?: { allowSources?: string[]; allowExecutables?: boolean };
  mcp?: { requirePinnedVersions?: boolean; allowServers?: string[]; denyPlainHttp?: boolean };
  hooks?: { allowNetwork?: boolean; allowAutoRunOnOpen?: boolean };
  contextFiles?: { denyHiddenUnicode?: boolean };
  exclude?: { path: string; reason: string }[];
  exceptions?: { rule: string; path: string; reason: string; until?: string }[];
  doctor?: { failOn?: DoctorLevel | 'none' };
}

/** One way a value breaks the schema, with the path to it, such as policy.mcp.allowServers[2]. */
export interface PolicyIssue {
  path: string;
  message: string;
}
