export const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Grep",
  "Glob",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookEdit",
  "Skill",
  "ExitPlanMode",
]);

export function isKnownTool(name: string): boolean {
  if (KNOWN_TOOLS.has(name)) return true;
  for (const t of KNOWN_TOOLS) {
    if (t.toLowerCase() === name.toLowerCase()) return true;
  }
  return false;
}
