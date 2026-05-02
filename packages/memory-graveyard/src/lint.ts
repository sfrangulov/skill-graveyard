import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudePaths } from "@skill-graveyard/core";
import { parseMemoryIndex } from "./index_parser.js";
import { scanEntryFiles } from "./entry_scanner.js";
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

  // Checks #3, #4, #5 added by subsequent tasks.

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return {
    generatedAt: new Date().toISOString(),
    memoryDir,
    findings,
    summary: { errors, warnings, ok: findings.length === 0 },
  };
}

function deriveProjectKeyFromCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}
