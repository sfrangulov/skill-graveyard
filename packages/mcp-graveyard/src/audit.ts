import { findSessionFiles, resolveClaudePaths } from "@skill-graveyard/core";
import { readMcpServers } from "./mcp_config.js";
import { parseMcpSession } from "./mcp_parser.js";
import type { McpServerEntry, McpServerSummary, McpBucket, AuditOptions, AuditReport, McpToolCall } from "./types.js";

export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const [servers, sessionFiles] = await Promise.all([
    readMcpServers(paths.claudeDir),
    findSessionFiles(paths.projectsDir, since),
  ]);
  const allCalls: McpToolCall[] = [];
  for (const sf of sessionFiles) {
    const calls = await parseMcpSession(sf.filepath, sf.projectKey);
    for (const c of calls) {
      if (c.timestamp && Date.parse(c.timestamp) < since) continue;
      allCalls.push(c);
    }
  }
  const summaries = aggregate(servers, allCalls);
  const filtered = opts.only ? summaries.filter((s) => s.bucket === opts.only) : summaries;
  return {
    generatedAt: new Date().toISOString(),
    windowDays: opts.windowDays,
    claudeDir: paths.claudeDir,
    summary: {
      configuredServers: servers.length,
      totalCalls: allCalls.length,
      successfulCalls: allCalls.filter((c) => !c.errored).length,
      erroredCalls: allCalls.filter((c) => c.errored).length,
    },
    rows: filtered,
  };
}

function aggregate(servers: McpServerEntry[], calls: McpToolCall[]): McpServerSummary[] {
  const byServer = new Map<string, McpToolCall[]>();
  for (const call of calls) {
    if (!byServer.has(call.server)) byServer.set(call.server, []);
    byServer.get(call.server)!.push(call);
  }
  const configured = new Map(servers.map((s) => [s.name, s]));
  const allServerNames = new Set([...configured.keys(), ...byServer.keys()]);

  const summaries: McpServerSummary[] = [];
  for (const name of allServerNames) {
    const cfg = configured.get(name);
    const serverCalls = byServer.get(name) ?? [];
    const successCalls = serverCalls.filter((c) => !c.errored);
    const errorCalls = serverCalls.filter((c) => c.errored);
    const toolsInvoked = [...new Set(successCalls.map((c) => c.tool))].sort();
    const toolsErrored = [...new Set(errorCalls.map((c) => c.tool))].sort();
    const toolsAdvertised = new Set(serverCalls.map((c) => c.tool)).size;
    const lastCall = serverCalls
      .map((c) => c.timestamp)
      .filter((t): t is string => t !== null)
      .sort()
      .pop() ?? null;

    let bucket: McpBucket;
    if (cfg && successCalls.length > 0) bucket = "active";
    else if (!cfg && successCalls.length > 0) bucket = "missing";
    else if (errorCalls.length > 0) bucket = "hallucinated";
    else bucket = "dead";   // configured & 0 calls of any kind

    summaries.push({
      name,
      configured: !!cfg,
      configuredIn: cfg?.configuredIn ?? null,
      toolsAdvertised,
      toolsInvoked,
      toolsErrored,
      totalCalls: serverCalls.length,
      successfulCalls: successCalls.length,
      erroredCalls: errorCalls.length,
      bucket,
      lastCallAt: lastCall,
    });
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
