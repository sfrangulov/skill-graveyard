import type {
  AuditReport,
  LintReport,
  PrunePlanItem,
} from "./types.js";

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
