import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Spinner } from "./spinner.js";

function makeStream(isTTY: boolean): NodeJS.WriteStream {
  const s = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperty(s, "isTTY", { value: isTTY });
  return s;
}

test("Spinner writes nothing when stream is not a TTY", () => {
  const stream = makeStream(false);
  const chunks: string[] = [];
  stream.on("data", (c) => chunks.push(String(c)));

  const sp = new Spinner({ stream, intervalMs: 1 });
  sp.start("loading");
  sp.stop();

  assert.equal(chunks.join(""), "");
});

test("Spinner emits a frame and clears on stop when TTY", () => {
  const stream = makeStream(true);
  const chunks: string[] = [];
  stream.on("data", (c) => chunks.push(String(c)));

  const sp = new Spinner({ stream, intervalMs: 50 });
  sp.start("scanning");
  sp.stop();

  const out = chunks.join("");
  assert.match(out, /scanning/);
  // Stop emits the clear-line escape so the next stdout write starts clean.
  assert.ok(out.endsWith("\r\x1b[K"));
});

test("Spinner stop is idempotent and start before TTY check is safe", () => {
  const stream = makeStream(false);
  const sp = new Spinner({ stream, intervalMs: 1 });
  sp.stop(); // before start, no-op
  sp.start("x");
  sp.stop();
  sp.stop(); // double-stop is fine
});
