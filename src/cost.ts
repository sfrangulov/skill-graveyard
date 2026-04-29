import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  runAudit,
  type AuditReport,
  type AuditRow,
} from "./audit.js";
import { findSessionFiles } from "./parser.js";

export const CHARS_PER_TOKEN = 4;

export interface SkillCost {
  invokeName: string;
  source: string;
  descTokens: number;
  sessionsLoaded: number;
  sessionsInvoked: number;
  invocations: number;
  waste: number;
}

export interface HookInjection {
  hookName: string;
  hookEvent: string;
  avgTokens: number;
  occurrences: number;
  totalTokens: number;
  contentSample: string;
}

export interface CostReport {
  generatedAt: string;
  windowDays: number;
  sessionsAnalyzed: number;
  charsPerToken: number;
  totalDescTokens: number;
  totalLoadedTokens: number;
  totalInvokedTokens: number;
  totalWasteTokens: number;
  perSkill: SkillCost[];
  hookInjections: HookInjection[];
}

export interface CostOptions {
  days: number;
  claudeDir?: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export async function runCost(opts: CostOptions): Promise<CostReport> {
  const audit = await runAudit({ days: opts.days, claudeDir: opts.claudeDir });
  return computeCost(audit, opts.days);
}

export async function computeCost(
  audit: AuditReport,
  windowDays: number,
): Promise<CostReport> {
  const perSkill: SkillCost[] = [];

  for (const row of audit.rows) {
    if (!row.installed) continue;
    const desc = await readSkillDescription(row.installed.skillDir);
    const descTokens = estimateTokens(desc);
    const sessionsInvoked = row.usage?.uniqueSessions ?? 0;
    const sessionsLoaded = audit.sessionsAnalyzed;
    const waste =
      descTokens * Math.max(0, sessionsLoaded - sessionsInvoked);
    perSkill.push({
      invokeName: row.invokeName,
      source: sourceShortLabel(row),
      descTokens,
      sessionsLoaded,
      sessionsInvoked,
      waste,
      invocations: row.usage?.totalCalls ?? 0,
    });
  }

  perSkill.sort((a, b) => b.waste - a.waste);

  const totalDescTokens = perSkill.reduce((s, x) => s + x.descTokens, 0);
  const totalLoadedTokens = perSkill.reduce(
    (s, x) => s + x.descTokens * x.sessionsLoaded,
    0,
  );
  const totalInvokedTokens = perSkill.reduce(
    (s, x) => s + x.descTokens * x.sessionsInvoked,
    0,
  );
  const totalWasteTokens = totalLoadedTokens - totalInvokedTokens;

  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const hookInjections = await scanHookInjections(
    audit.paths.projectsDir,
    sinceMs,
  );

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    sessionsAnalyzed: audit.sessionsAnalyzed,
    charsPerToken: CHARS_PER_TOKEN,
    totalDescTokens,
    totalLoadedTokens,
    totalInvokedTokens,
    totalWasteTokens,
    perSkill,
    hookInjections,
  };
}

async function readSkillDescription(skillDir: string): Promise<string> {
  for (const fname of ["SKILL.md", "skill.md"]) {
    try {
      const content = await readFile(join(skillDir, fname), "utf8");
      return parseDescription(content);
    } catch {}
  }
  return "";
}

export function parseDescription(content: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch || !fmMatch[1]) return "";
  const front = fmMatch[1];
  const lines = front.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/^description:\s*(.*)$/);
    if (!m) continue;
    let value = (m[1] ?? "").trim();
    if (value.length === 0) return "";
    const first = value[0];
    if (first === "'" || first === '"') {
      if (value.length >= 2 && value.endsWith(first)) {
        return value.slice(1, -1);
      }
      let buf = value.slice(1);
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (next.endsWith(first)) {
          buf += "\n" + next.slice(0, -1);
          break;
        }
        buf += "\n" + next;
      }
      return buf;
    }
    return value;
  }
  return "";
}

function sourceShortLabel(row: AuditRow): string {
  if (!row.installed) return "—";
  const s = row.installed.source;
  if (s.kind === "plugin") return `plugin:${s.pluginName}`;
  if (s.kind === "project") {
    const base = s.projectDir.split("/").filter(Boolean).pop() ?? "?";
    return `project:${base}`;
  }
  return s.kind;
}

async function scanHookInjections(
  projectsDir: string,
  sinceMs: number,
): Promise<HookInjection[]> {
  const files = await findSessionFiles(projectsDir, sinceMs);
  const acc = new Map<
    string,
    { hookName: string; hookEvent: string; tokens: number[]; sample: string }
  >();

  for (const f of files) {
    const found = await scanFileForInjections(f.filepath);
    for (const inj of found) {
      const key = `${inj.hookName}|${inj.hookEvent}`;
      const entry = acc.get(key) ?? {
        hookName: inj.hookName,
        hookEvent: inj.hookEvent,
        tokens: [],
        sample: inj.sample,
      };
      entry.tokens.push(inj.tokens);
      acc.set(key, entry);
    }
  }

  const out: HookInjection[] = [];
  for (const e of acc.values()) {
    const total = e.tokens.reduce((s, t) => s + t, 0);
    const avg = e.tokens.length === 0 ? 0 : Math.round(total / e.tokens.length);
    out.push({
      hookName: e.hookName,
      hookEvent: e.hookEvent,
      avgTokens: avg,
      occurrences: e.tokens.length,
      totalTokens: total,
      contentSample: e.sample,
    });
  }
  out.sort((a, b) => b.totalTokens - a.totalTokens);
  return out;
}

async function scanFileForInjections(
  filepath: string,
): Promise<
  Array<{ hookName: string; hookEvent: string; tokens: number; sample: string }>
> {
  const stream = createReadStream(filepath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const out: Array<{
    hookName: string;
    hookEvent: string;
    tokens: number;
    sample: string;
  }> = [];
  let scanned = 0;
  for await (const line of rl) {
    scanned++;
    if (scanned > 50) break;
    if (!line.includes('"hook_additional_context"')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(obj)) continue;
    if (obj.type !== "attachment") continue;
    const att = obj.attachment;
    if (!isObject(att)) continue;
    if (att.type !== "hook_additional_context") continue;
    const hookName = typeof att.hookName === "string" ? att.hookName : "?";
    const hookEvent = typeof att.hookEvent === "string" ? att.hookEvent : "?";
    let text = "";
    const c = att.content;
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (typeof part === "string") text += part;
        else if (isObject(part) && typeof part.text === "string") text += part.text;
      }
    }
    const tokens = estimateTokens(text);
    const sample = text.slice(0, 80).replace(/\s+/g, " ");
    out.push({ hookName, hookEvent, tokens, sample });
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
