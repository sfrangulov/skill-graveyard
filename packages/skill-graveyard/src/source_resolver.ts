export interface MarketplaceEntry {
  name: string;
  version?: string;
  source?: string | {
    source: string;
    url?: string;
    path?: string;
    ref?: string;
    sha?: string;
  };
}

export type Strategy =
  | { kind: "version-on-entry"; version: string }
  | { kind: "sha-pinned"; url: string; sha: string }
  | { kind: "sha-pinned-or-ref"; url: string; branch: string }
  | { kind: "ls-remote-upstream"; url: string; branch: string }
  | { kind: "ls-remote-marketplace" }
  | { kind: "unknown-shape" };

export function classifyMarketplaceEntry(entry: MarketplaceEntry): Strategy {
  // Type A: explicit version on entry
  if (typeof entry.version === "string" && entry.version.length > 0) {
    return { kind: "version-on-entry", version: entry.version };
  }

  const src = entry.source;

  // Type D: string source — points into the marketplace repo itself
  if (typeof src === "string") {
    return { kind: "ls-remote-marketplace" };
  }

  // From here on, src must be an object with a url; otherwise unknown
  if (!src || typeof src !== "object" || typeof src.url !== "string") {
    return { kind: "unknown-shape" };
  }

  // Type B: explicit sha pin (any source-kind that carries a sha)
  if (typeof src.sha === "string" && src.sha.length > 0) {
    return { kind: "sha-pinned", url: src.url, sha: src.sha };
  }

  const stripPrefix = (ref: string) => ref.replace(/^refs\/heads\//, "");

  // Type B-prime: git-subdir without sha but with ref → ls-remote on that ref
  if (src.source === "git-subdir" && typeof src.ref === "string") {
    return { kind: "sha-pinned-or-ref", url: src.url, branch: stripPrefix(src.ref) };
  }

  // Type C: url-source (or any other object source without sha pin) → upstream HEAD
  // Optional `ref` overrides the default branch.
  const branch = typeof src.ref === "string" ? stripPrefix(src.ref) : "main";
  return { kind: "ls-remote-upstream", url: src.url, branch };
}
