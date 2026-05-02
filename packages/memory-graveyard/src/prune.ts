import { mkdir, writeFile, readFile, copyFile, unlink, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditReport,
  LintReport,
  PrunePlanItem,
} from "./types.js";
import { parseMemoryIndex } from "./index_parser.js";

interface PlanFlags {
  include: { orphans: boolean; brokenPointers: boolean };
  exclude: Set<string>;
}

export function planPrune(audit: AuditReport, lint: LintReport, flags: PlanFlags): PrunePlanItem[] {
  const plan: PrunePlanItem[] = [];
  for (const r of audit.rows) {
    if (r.bucket === "dead") {
      plan.push({
        basename: r.basename,
        reason: "dead",
        pointerLine: r.pointer?.line ?? null,
        fileExists: r.fileExists,
      });
    } else if (r.bucket === "hallucinated") {
      plan.push({
        basename: r.basename,
        reason: "hallucinated",
        pointerLine: r.pointer?.line ?? null,
        fileExists: false,
      });
    }
  }
  if (flags.include.orphans) {
    const orph = lint.findings.find((f) => f.check === "orphans");
    if (orph) {
      const list = orph.details as { basename: string; bytes: number }[];
      for (const o of list) plan.push({ basename: o.basename, reason: "orphan", pointerLine: null, fileExists: true });
    }
  }
  if (flags.include.brokenPointers) {
    const bp = lint.findings.find((f) => f.check === "broken-pointers");
    if (bp) {
      const list = bp.details as { line: number; title: string; target: string }[];
      const audited = new Set(audit.rows.filter((r) => r.bucket === "hallucinated").map((r) => r.basename));
      for (const x of list) {
        if (audited.has(x.target)) continue; // already in plan as hallucinated
        plan.push({ basename: x.target, reason: "broken-pointer", pointerLine: x.line, fileExists: false });
      }
    }
  }
  return plan.filter((p) => !flags.exclude.has(p.basename));
}

export interface ApplyResult {
  deleted: string[];
  failed: { basename: string; error: string }[];
  removedPointerLines: number[];
  backupDir: string;
}

export async function applyPrune(
  memoryDir: string,
  plan: PrunePlanItem[],
): Promise<ApplyResult> {
  const memoryMdPath = join(memoryDir, "MEMORY.md");
  const indexContent = existsSync(memoryMdPath) ? await readFile(memoryMdPath, "utf8") : "";
  const pointers = parseMemoryIndex(indexContent, Number.POSITIVE_INFINITY);
  const planTargets = new Set(plan.map((p) => p.basename));
  const linesToRemove = new Set(
    pointers.filter((p) => planTargets.has(p.target)).map((p) => p.line),
  );

  // 1. Snapshot
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(memoryDir, ".graveyard-backup", ts);
  await mkdir(backupDir, { recursive: true });
  await chmod(backupDir, 0o700);
  if (indexContent) {
    await writeFile(join(backupDir, "MEMORY.md"), indexContent, { mode: 0o600 });
  }
  const filesToDelete: string[] = [];
  for (const item of plan) {
    if (!item.fileExists) continue;
    const src = join(memoryDir, item.basename);
    if (!existsSync(src)) continue;
    await copyFile(src, join(backupDir, item.basename));
    await chmod(join(backupDir, item.basename), 0o600);
    filesToDelete.push(item.basename);
  }

  // 2. MEMORY.md edits
  const removedLines: number[] = [];
  if (linesToRemove.size > 0 && indexContent) {
    const lines = indexContent.split("\n");
    const filtered = lines.filter((_, i) => {
      const lineNum = i + 1;
      if (linesToRemove.has(lineNum)) {
        removedLines.push(lineNum);
        return false;
      }
      return true;
    });
    await writeFile(memoryMdPath, filtered.join("\n"));
  }

  // 3. Delete entry files
  const deleted: string[] = [];
  const failed: { basename: string; error: string }[] = [];
  for (const basename of filesToDelete) {
    try {
      await unlink(join(memoryDir, basename));
      deleted.push(basename);
    } catch (e) {
      failed.push({ basename, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 4. Manifest
  const manifest = {
    removedAt: new Date().toISOString(),
    memoryDir,
    deletedFiles: deleted,
    removedPointerLines: pointers
      .filter((p) => removedLines.includes(p.line))
      .map((p) => ({ line: p.line, title: p.title, target: p.target })),
    failed,
    restoreHint: `cp -i ${backupDir}/MEMORY.md ${memoryMdPath} && cp -i ${backupDir}/*.md ${memoryDir}/`,
  };
  await writeFile(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  return { deleted, failed, removedPointerLines: removedLines, backupDir };
}
