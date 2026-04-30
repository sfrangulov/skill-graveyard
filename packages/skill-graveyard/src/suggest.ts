import { homedir } from "node:os";
import { runAudit, type AuditReport, type AuditRow } from "./audit.js";
import { isKnownTool } from "./known_tools.js";

export type SuggestBucket =
  | "tool_confusion"
  | "external_framework"
  | "typo"
  | "unclassified";

export interface SuggestEntry {
  invokeName: string;
  invocations: number;
  bucket: SuggestBucket;
  detail: string;
  closestMatch?: string;
  framework?: string;
}

export interface SuggestReport {
  generatedAt: string;
  windowDays: number;
  groups: Record<SuggestBucket, SuggestEntry[]>;
  totalActionable: number;
}

export interface SuggestOptions {
  days: number;
  claudeDir?: string;
}

export async function runSuggest(opts: SuggestOptions): Promise<SuggestReport> {
  const audit = await runAudit({ days: opts.days, claudeDir: opts.claudeDir });
  return classifyAudit(audit);
}

export function classifyAudit(audit: AuditReport): SuggestReport {
  const home = homedir();
  const installedNames = audit.rows
    .filter((r) => r.installed)
    .map((r) => r.invokeName);

  const groups: Record<SuggestBucket, SuggestEntry[]> = {
    tool_confusion: [],
    external_framework: [],
    typo: [],
    unclassified: [],
  };

  for (const row of audit.rows) {
    if (row.category !== "hallucinated" && row.category !== "missing") continue;
    const entry = classifyRow(row, installedNames, home);
    groups[entry.bucket].push(entry);
  }

  for (const bucket of Object.keys(groups) as SuggestBucket[]) {
    groups[bucket].sort((a, b) => b.invocations - a.invocations);
  }

  const totalActionable =
    groups.external_framework.length + groups.typo.length;

  return {
    generatedAt: new Date().toISOString(),
    windowDays: audit.windowDays,
    groups,
    totalActionable,
  };
}

function classifyRow(
  row: AuditRow,
  installedNames: string[],
  home: string,
): SuggestEntry {
  const invokeName = row.invokeName;
  const invocations = row.usage?.totalCalls ?? 0;

  if (isKnownTool(invokeName)) {
    return {
      invokeName,
      invocations,
      bucket: "tool_confusion",
      detail: "Claude invoked a built-in CC tool name as a skill",
    };
  }

  if (row.category === "missing") {
    const cwds = row.usage?.observedCwds ?? [];
    const framework = detectExternalFramework(cwds, home);
    if (framework) {
      return {
        invokeName,
        invocations,
        bucket: "external_framework",
        detail: `all invocations originate from ~/.${framework}/ — likely registered by that framework`,
        framework,
      };
    }
  }

  const closest = closestInstalled(invokeName, installedNames);
  if (closest && closest.distance <= 2 && closest.distance > 0) {
    return {
      invokeName,
      invocations,
      bucket: "typo",
      detail: `closest installed: ${closest.name} (distance ${closest.distance})`,
      closestMatch: closest.name,
    };
  }

  return {
    invokeName,
    invocations,
    bucket: "unclassified",
    detail: "no matching pattern — review manually",
  };
}

function detectExternalFramework(
  cwds: string[],
  home: string,
): string | null {
  if (cwds.length === 0) return null;
  const homeWithSlash = home.endsWith("/") ? home : home + "/";

  let framework: string | null = null;
  for (const cwd of cwds) {
    if (!cwd.startsWith(homeWithSlash)) return null;
    const rest = cwd.slice(homeWithSlash.length);
    const firstSeg = rest.split("/")[0] ?? "";
    if (!firstSeg.startsWith(".")) return null;
    if (firstSeg === ".claude") return null;
    const name = firstSeg.slice(1);
    if (!name) return null;
    if (framework === null) framework = name;
    else if (framework !== name) return null;
  }
  return framework;
}

function closestInstalled(
  name: string,
  installed: string[],
): { name: string; distance: number } | null {
  let best: { name: string; distance: number } | null = null;
  for (const candidate of installed) {
    const d = levenshtein(name, candidate);
    if (!best || d < best.distance) {
      best = { name: candidate, distance: d };
    }
  }
  return best;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}
