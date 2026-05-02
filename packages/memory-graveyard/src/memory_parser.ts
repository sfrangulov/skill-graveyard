import { normalize, basename } from "node:path";
import { parseToolCalls } from "@skill-graveyard/core";
import type { MemoryRead } from "./types.js";

export async function parseMemorySession(
  filepath: string,
  projectKey: string,
  memoryDir: string,
): Promise<MemoryRead[]> {
  const normalizedDir = normalize(memoryDir).replace(/\/$/, "");

  return parseToolCalls<MemoryRead>(
    filepath,
    projectKey,
    (item) =>
      item.type === "tool_use" &&
      item.name === "Read" &&
      typeof (item.input as Record<string, unknown> | undefined)?.file_path === "string",
    (item, base) => {
      const input = item.input as Record<string, unknown>;
      const rawPath = input.file_path as string;
      const filePath = normalize(rawPath);

      // Filter: must be inside memoryDir
      if (!filePath.startsWith(normalizedDir + "/")) return null;

      // Exclude MEMORY.md itself
      const memoryFile = basename(filePath);
      if (memoryFile === "MEMORY.md") return null;

      const call: MemoryRead = {
        ...base,
        kind: "memory",
        filePath,
        memoryFile,
        memoryDir: normalizedDir,
      };
      return call;
    },
  );
}
