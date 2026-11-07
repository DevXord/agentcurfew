export type HookDecision = 'deny' | 'ask';

/** What the hook says about one tool call; no verdict means the call goes through the agent's own permission flow. */
export interface Verdict {
  decision: HookDecision;
  reasons: string[];
}

export function combine(verdicts: readonly (Verdict | undefined)[]): Verdict | undefined {
  const present = verdicts.filter((verdict): verdict is Verdict => verdict !== undefined);
  if (present.length === 0) return undefined;
  const decision: HookDecision = present.some((verdict) => verdict.decision === 'deny') ? 'deny' : 'ask';
  return { decision, reasons: [...new Set(present.filter((verdict) => verdict.decision === decision || decision === 'ask').flatMap((verdict) => verdict.reasons))] };
}
