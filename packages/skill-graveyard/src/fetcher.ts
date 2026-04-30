import { spawn } from "node:child_process";

export interface Fetcher {
  /** Returns parsed JSON of marketplace.json from the marketplace's source repo. */
  fetchMarketplace(githubRepo: string, entryPath?: string): Promise<unknown>;
  /** Returns the SHA of the named branch on the remote, or null if not found. */
  gitLsRemote(remoteUrl: string, branch: string): Promise<string | null>;
}

export function parseLsRemoteOutput(stdout: string, branch: string): string | null {
  const ref = `refs/heads/${branch}`;
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    if (line.slice(tab + 1).trim() === ref) {
      return line.slice(0, tab).trim();
    }
  }
  return null;
}

async function runGitLsRemote(remoteUrl: string, branch: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "git",
      ["-c", "credential.helper=", "ls-remote", remoteUrl, `refs/heads/${branch}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (b) => (out += b));
    proc.stderr.on("data", (b) => (err += b));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`git ls-remote exited ${code}: ${err.trim()}`));
    });
  });
}

export const realFetcher: Fetcher = {
  async fetchMarketplace(githubRepo, entryPath = ".claude-plugin/marketplace.json") {
    const url = `https://raw.githubusercontent.com/${githubRepo}/HEAD/${entryPath}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "skill-graveyard/outdated" },
    });
    if (!res.ok) throw new Error(`marketplace fetch ${url} -> ${res.status}`);
    return await res.json();
  },
  async gitLsRemote(remoteUrl, branch) {
    const out = await runGitLsRemote(remoteUrl, branch);
    return parseLsRemoteOutput(out, branch);
  },
};
