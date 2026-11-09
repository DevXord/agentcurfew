import { knowledgeDate } from '../knowledge/index.ts';
import { getVersion } from '../version.ts';

/** What made a JSON output: the tool, its version and the date of its knowledge base. No time, so outputs stay comparable. */
export function producer(): { name: string; version: string; knowledge: string } {
  return { name: 'agentcurfew', version: getVersion(), knowledge: knowledgeDate() };
}
