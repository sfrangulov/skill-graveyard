import { readFile } from "node:fs/promises";
import type { McpServerEntry } from "./types.js";

export async function readMcpServers(claudeJsonPath: string): Promise<McpServerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(claudeJsonPath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObject(parsed)) return [];
  const mcpServers = parsed.mcpServers;
  if (!isObject(mcpServers)) return [];

  const out: McpServerEntry[] = [];
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (!isObject(entry)) continue;
    out.push({
      name,
      command: typeof entry.command === "string" ? entry.command : null,
      args: Array.isArray(entry.args)
        ? entry.args.filter((a): a is string => typeof a === "string")
        : null,
      env: isObject(entry.env)
        ? Object.fromEntries(
            Object.entries(entry.env).filter(
              ([, v]) => typeof v === "string"
            ) as [string, string][]
          )
        : null,
      configuredIn: claudeJsonPath,
    });
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
