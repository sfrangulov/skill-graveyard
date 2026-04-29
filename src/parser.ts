import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface SkillCall {
  skill: string;
  sessionId: string;
  projectKey: string;
  filepath: string;
  cwd: string | null;
  timestamp: string | null;
  toolUseId: string;
  errored: boolean;
  errorReason: string | null;
}

const SKILL_TOKEN = '"name":"Skill"';
const RESULT_TOKEN = '"type":"tool_result"';
const ERROR_PATTERNS =
  /InputValidationError|skill not found|does not exist|unknown skill|cannot find skill|not a known skill/i;

export async function findSessionFiles(
  projectsDir: string,
  sinceMs: number,
): Promise<{ filepath: string; projectKey: string; mtimeMs: number }[]> {
  const out: { filepath: string; projectKey: string; mtimeMs: number }[] = [];
  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch {
    return out;
  }
  for (const projectKey of entries) {
    const dir = join(projectsDir, projectKey);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const filepath = join(dir, f);
      try {
        const s = await stat(filepath);
        if (s.mtimeMs < sinceMs) continue;
        out.push({ filepath, projectKey, mtimeMs: s.mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return out;
}

export async function parseSession(
  filepath: string,
  projectKey: string,
): Promise<SkillCall[]> {
  const stream = createReadStream(filepath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const calls: SkillCall[] = [];
  const pending = new Map<string, SkillCall>();
  let lastCwd: string | null = null;

  for await (const line of rl) {
    if (!line) continue;
    const hasSkill = line.includes(SKILL_TOKEN);
    const hasResult = line.includes(RESULT_TOKEN);
    const needCwd = lastCwd === null && line.includes('"cwd":"');
    if (!hasSkill && !hasResult && !needCwd) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(obj)) continue;

    if (typeof obj.cwd === "string") lastCwd = obj.cwd;
    if (!hasSkill && !hasResult) continue;

    const message = obj.message;
    if (!isObject(message)) continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;

    const sessionId =
      typeof obj.sessionId === "string" ? obj.sessionId : "unknown";
    const timestamp =
      typeof obj.timestamp === "string" ? obj.timestamp : null;

    for (const item of content) {
      if (!isObject(item)) continue;

      if (item.type === "tool_use" && item.name === "Skill") {
        const input = item.input;
        const skill = isObject(input) && typeof input.skill === "string" ? input.skill : null;
        if (!skill) continue;
        const toolUseId = typeof item.id === "string" ? item.id : "";
        const call: SkillCall = {
          skill,
          sessionId,
          projectKey,
          filepath,
          cwd: lastCwd,
          timestamp,
          toolUseId,
          errored: false,
          errorReason: null,
        };
        calls.push(call);
        if (toolUseId) pending.set(toolUseId, call);
      } else if (item.type === "tool_result") {
        const tid = typeof item.tool_use_id === "string" ? item.tool_use_id : null;
        if (!tid) continue;
        const call = pending.get(tid);
        if (!call) continue;
        const isError = item.is_error === true;
        const text = extractText(item.content);
        const matched = text && ERROR_PATTERNS.test(text);
        if (isError || matched) {
          call.errored = true;
          call.errorReason = matched ? text.slice(0, 200) : "is_error";
        }
        pending.delete(tid);
      }
    }
  }

  return calls;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c === "string") parts.push(c);
    else if (isObject(c) && typeof c.text === "string") parts.push(c.text);
  }
  return parts.join("\n");
}
