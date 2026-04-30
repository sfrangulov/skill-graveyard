import { readFile, writeFile, stat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export class Cache {
  constructor(private readonly dir: string) {}

  /** Returns the cached value if present and not older than ttlMinutes. Otherwise null. */
  async get<T>(key: string, ttlMinutes: number): Promise<T | null> {
    const path = this.pathFor(key);
    let st;
    try {
      st = await stat(path);
    } catch {
      return null;
    }
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > ttlMinutes * 60 * 1000) return null;
    try {
      return JSON.parse(await readFile(path, "utf-8")) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(key), JSON.stringify(value), "utf-8");
  }

  async invalidate(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // already gone — fine
    }
  }

  private pathFor(key: string): string {
    // sanitize: only allow [A-Za-z0-9_-]; replace others with '-'
    const safe = key.replace(/[^A-Za-z0-9_-]/g, "-");
    return join(this.dir, `${safe}.json`);
  }
}
