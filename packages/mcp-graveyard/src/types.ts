import type { ToolCallBase } from "@skill-graveyard/core";

export interface McpToolCall extends ToolCallBase {
  rawName: string;     // e.g. "mcp__plugin_supabase_supabase__apply_migration"
  server: string;      // "plugin_supabase_supabase"
  tool: string;        // "apply_migration"
}

export interface McpServerEntry {
  name: string;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  configuredIn: string;   // absolute path of ~/.claude.json
}

export type McpBucket = "active" | "dead" | "missing" | "hallucinated";

export interface McpServerSummary {
  name: string;
  configured: boolean;
  configuredIn: string | null;
  toolsAdvertised: number;       // distinct mcp__<server>__* names seen in window
  toolsInvoked: string[];        // tools with ≥1 successful call (sorted)
  toolsErrored: string[];        // tools with InputValidationError (sorted)
  totalCalls: number;
  successfulCalls: number;
  erroredCalls: number;
  bucket: McpBucket;
  lastCallAt: string | null;
}

export interface AuditOptions {
  claudeDir?: string;
  windowDays: number;
  only?: McpBucket;
}

export interface AuditReport {
  generatedAt: string;
  windowDays: number;
  claudeDir: string;
  summary: {
    configuredServers: number;
    totalCalls: number;
    successfulCalls: number;
    erroredCalls: number;
  };
  rows: McpServerSummary[];
}
