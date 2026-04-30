import { isKnownTool } from "@skill-graveyard/core";
import { runAudit } from "./audit.js";

export type SuggestCategory = "TYPO" | "REMOVED_SERVER" | "TOOL_CONFUSION" | "UNCLASSIFIED";

export interface SuggestRow {
  server: string;
  category: SuggestCategory;
  match?: string;          // configured server name for TYPO
  reason?: string;
}

export function classify(server: string, configuredServers: string[]): SuggestRow {
  if (isKnownTool(server)) {
    return { server, category: "TOOL_CONFUSION", reason: `"${server}" is a built-in CC tool name, not an MCP server` };
  }
  let best: { name: string; dist: number } | null = null;
  for (const c of configuredServers) {
    const d = levenshtein(server, c);
    if (d <= 2 && (best === null || d < best.dist || (d === best.dist && c < best.name))) {
      best = { name: c, dist: d };
    }
  }
  if (best !== null) {
    return { server, category: "TYPO", match: best.name, reason: `≈ "${best.name}" (distance ${best.dist})` };
  }
  return { server, category: "UNCLASSIFIED" };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}

export async function runSuggest(opts: { claudeDir?: string; windowDays: number }): Promise<SuggestRow[]> {
  const report = await runAudit({ claudeDir: opts.claudeDir, windowDays: opts.windowDays });
  const configured = report.rows.filter((r) => r.configured).map((r) => r.name);
  const targets = report.rows.filter((r) => r.bucket === "missing" || r.bucket === "hallucinated");
  const out: SuggestRow[] = [];
  for (const t of targets) {
    if (configured.includes(t.name)) continue;  // exact match — not actionable
    out.push(classify(t.name, configured));
  }
  return out;
}
