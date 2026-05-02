import type { ToolCallBase } from "@skill-graveyard/core";

export type Bucket = "active" | "dead" | "missing" | "hallucinated";

export interface MemoryRead extends ToolCallBase {
  kind: "memory";
  filePath: string;
  memoryFile: string;
  memoryDir: string;
}

export interface Pointer {
  line: number;
  title: string;
  target: string;
  hook: string;
  visible: boolean;
}

export interface EntryFile {
  basename: string;
  path: string;
  exists: boolean;
  frontmatter: { name?: string; description?: string; type?: string } | null;
  bytes: number;
  mtime: string;
}

export interface EntryReport {
  basename: string;
  inIndex: boolean;
  fileExists: boolean;
  pointer: Pointer | null;
  entry: EntryFile | null;
  reads: MemoryRead[];
  errors: MemoryRead[];
  bucket: Bucket;
  lastReadAt: string | null;
}

export interface AuditOptions {
  claudeDir?: string;
  windowDays: number;
  only?: Bucket;
  projectKey?: string;
  cwd?: string;
}

export interface AuditReport {
  generatedAt: string;
  windowDays: number;
  claudeDir: string;
  projectKey: string;
  memoryDir: string;
  summary: {
    indexedEntries: number;
    onDiskEntries: number;
    totalReads: number;
    successfulReads: number;
    erroredReads: number;
  };
  rows: EntryReport[];
}

export interface LintOptions {
  claudeDir?: string;
  projectKey?: string;
  cwd?: string;
  truncationCutoff: number;
  staleDays: number;
}

export interface LintFinding {
  check:
    | "broken-pointers"
    | "orphans"
    | "truncation-budget"
    | "index-size"
    | "stale-dated";
  severity: "error" | "warning" | "info";
  details: unknown;
}

export interface LintReport {
  generatedAt: string;
  memoryDir: string;
  findings: LintFinding[];
  summary: { errors: number; warnings: number; ok: boolean };
}

export interface PrunePlanItem {
  basename: string;
  reason: "dead" | "hallucinated" | "orphan" | "broken-pointer";
  pointerLine: number | null;
  fileExists: boolean;
}

export interface PruneOptions {
  claudeDir?: string;
  projectKey?: string;
  cwd?: string;
  apply: boolean;
  include: { orphans: boolean; brokenPointers: boolean };
  exclude: Set<string>;
  windowDays: number;
}

export interface ProjectMemorySummary {
  projectKey: string;
  cwd: string | null;
  memoryDir: string;
  entryCount: number;
  totalBytes: number;
  lastReadAt: string | null;
  lastTouchedAt: string | null;
  daysSinceTouch: number;
  cold: boolean;
}
