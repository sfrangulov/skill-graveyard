import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "./cache.js";

async function withTmpCache<T>(fn: (cache: Cache, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "skg-cache-"));
  try {
    return await fn(new Cache(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cache miss returns null", async () => {
  await withTmpCache(async (cache) => {
    const v = await cache.get<{ x: number }>("missing", 60);
    assert.equal(v, null);
  });
});

test("cache write then read roundtrips", async () => {
  await withTmpCache(async (cache) => {
    await cache.set("k", { x: 42 });
    const v = await cache.get<{ x: number }>("k", 60);
    assert.deepEqual(v, { x: 42 });
  });
});

test("expired entry returns null and is treated as a miss", async () => {
  await withTmpCache(async (cache, dir) => {
    await cache.set("k", { x: 1 });
    const past = new Date(Date.now() - 1000 * 60 * 90); // 90 min ago
    await utimes(join(dir, "k.json"), past, past);
    const v = await cache.get<{ x: number }>("k", 60);
    assert.equal(v, null);
  });
});

test("invalidate deletes the entry", async () => {
  await withTmpCache(async (cache) => {
    await cache.set("k", { x: 1 });
    await cache.invalidate("k");
    const v = await cache.get<{ x: number }>("k", 60);
    assert.equal(v, null);
  });
});

test("invalidate is idempotent for missing entries", async () => {
  await withTmpCache(async (cache) => {
    await cache.invalidate("never-existed"); // no throw
  });
});
