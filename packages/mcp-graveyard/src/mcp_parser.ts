import { parseToolCalls } from "@skill-graveyard/core";
import type { McpToolCall } from "./types.js";

export function parseMcpName(name: string): { server: string; tool: string } | null {
  const PREFIX = "mcp__";
  if (!name.startsWith(PREFIX)) return null;
  const body = name.slice(PREFIX.length);
  const lastSep = body.lastIndexOf("__");
  if (lastSep <= 0) return null;
  const server = body.slice(0, lastSep);
  const tool = body.slice(lastSep + 2);
  if (!server || !tool) return null;
  return { server, tool };
}

export async function parseMcpSession(
  filepath: string,
  projectKey: string,
): Promise<McpToolCall[]> {
  return parseToolCalls<McpToolCall>(
    filepath,
    projectKey,
    (item) =>
      item.type === "tool_use" &&
      typeof item.name === "string" &&
      item.name.startsWith("mcp__"),
    (item, base) => {
      const rawName = typeof item.name === "string" ? item.name : "";
      const parsed = parseMcpName(rawName);
      if (!parsed) return null;
      const call: McpToolCall = { ...base, rawName, server: parsed.server, tool: parsed.tool };
      // Override default error filter: we only count InputValidationError as "hallucinated".
      // parseToolCalls already populates `errored: true` for any is_error result.
      // We post-filter here (see below).
      return call;
    },
  ).then((calls) =>
    calls.map((call) => {
      if (!call.errored) return call;
      const reason = call.errorReason ?? "";
      const isValidationError = /InputValidationError|tool not found|unknown tool|does not exist/i.test(reason);
      if (isValidationError) return call;
      // Tool ran but returned a runtime error — not hallucination, reset.
      return { ...call, errored: false, errorReason: null };
    }),
  );
}
