import { parseToolCalls } from "@skill-graveyard/core";
import type { McpToolCall } from "./types.js";

// Known v1 quirk: real MCP names like `mcp__plugin_claude-mem_mcp-search____IMPORTANT`
// (with `____` — empty middle segment) parse to server="plugin_claude-mem_mcp-search__"
// (trailing `__`) under our rightmost-`__` rule. The configured key in `~/.claude.json` won't
// have the trailing `__`, so such calls mis-bucket as `missing`/`hallucinated`. Accepted for
// v1 as a rare real-world shape; not normalized to avoid false-positives on legitimate names.
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
      // Note: only `InputValidationError` reliably triggers in practice. Core sets `errorReason` to
      // the literal "is_error" sentinel for is_error tool_results whose text doesn't match its own
      // (skill-flavored) ERROR_PATTERNS regex, so the other alternatives are unreachable today. They
      // stay as forward-compat hooks for a future core change that preserves the actual result text.
      const isValidationError = /InputValidationError|tool not found|unknown tool|does not exist/i.test(reason);
      if (isValidationError) return call;
      // Tool ran but returned a runtime error — not hallucination, reset.
      return { ...call, errored: false, errorReason: null };
    }),
  );
}
