import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudePaths, estimateTokens } from "@skill-graveyard/core";
import { parseMemoryIndex } from "./index_parser.js";
import { scanEntryFiles, readEntryBody } from "./entry_scanner.js";
import type { LintOptions, LintReport, LintFinding } from "./types.js";

export async function runLint(opts: LintOptions): Promise<LintReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const projectKey = opts.projectKey ?? deriveProjectKeyFromCwd(opts.cwd ?? process.cwd());
  const memoryDir = join(paths.projectsDir, projectKey, "memory");
  const memoryMdPath = join(memoryDir, "MEMORY.md");
  const indexContent = existsSync(memoryMdPath) ? await readFile(memoryMdPath, "utf8") : "";
  const pointers = parseMemoryIndex(indexContent, opts.truncationCutoff);
  const entries = await scanEntryFiles(memoryDir);

  const findings: LintFinding[] = [];

  // #1 — broken pointers
  const brokenList = pointers
    .filter((p) => !existsSync(join(memoryDir, p.target)))
    .map((p) => ({ line: p.line, title: p.title, target: p.target }));
  if (brokenList.length > 0) {
    findings.push({ check: "broken-pointers", severity: "error", details: brokenList });
  }

  // #2 — orphans
  const indexed = new Set(pointers.map((p) => p.target));
  const orphanList = entries
    .filter((e) => !indexed.has(e.basename))
    .map((e) => ({ basename: e.basename, bytes: e.bytes }));
  if (orphanList.length > 0) {
    findings.push({ check: "orphans", severity: "warning", details: orphanList });
  }

  // #3 — truncation budget
  const cutOff = pointers.filter((p) => !p.visible);
  if (cutOff.length > 0) {
    findings.push({
      check: "truncation-budget",
      severity: "warning",
      details: {
        total: pointers.length,
        visible: pointers.length - cutOff.length,
        cutOff: cutOff.length,
        cutoff: opts.truncationCutoff,
        sample: cutOff.slice(0, 5).map((p) => ({ line: p.line, target: p.target, title: p.title })),
      },
    });
  }

  // #4 — index size
  const tokens = estimateTokens(indexContent);
  const threshold = 5000;
  const over = tokens > threshold;
  findings.push({
    check: "index-size",
    severity: over ? "warning" : "info",
    details: { tokens, threshold, over },
  });

  // #5 — stale dated project entries
  const dateRe = /\b20\d{2}-\d{2}-\d{2}\b/g;
  const cutoff = Date.now() - opts.staleDays * 24 * 60 * 60 * 1000;
  const staleList: { basename: string; lastDate: string; daysAgo: number }[] = [];
  for (const e of entries) {
    if (e.frontmatter?.type !== "project") continue;
    let body: string;
    try {
      body = await readEntryBody(e.path);
    } catch {
      continue;
    }
    const matches = body.match(dateRe);
    if (!matches || matches.length === 0) continue;
    const sorted = [...matches].sort();
    const lastDate = sorted[sorted.length - 1]!;
    const ts = Date.parse(lastDate + "T00:00:00Z");
    if (!Number.isFinite(ts)) continue;
    if (ts < cutoff) {
      const daysAgo = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
      staleList.push({ basename: e.basename, lastDate, daysAgo });
    }
  }
  if (staleList.length > 0) {
    findings.push({ check: "stale-dated", severity: "warning", details: staleList });
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return {
    generatedAt: new Date().toISOString(),
    memoryDir,
    findings,
    summary: { errors, warnings, ok: errors === 0 && warnings === 0 },
  };
}

function deriveProjectKeyFromCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}
