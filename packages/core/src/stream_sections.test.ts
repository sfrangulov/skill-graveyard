import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { streamSections, shouldAnimate } from "./stream_sections.js";

function makeStream(isTTY: boolean): {
  stream: NodeJS.WriteStream;
  read: () => string;
} {
  const s = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperty(s, "isTTY", { value: isTTY });
  const chunks: string[] = [];
  s.on("data", (c) => chunks.push(String(c)));
  return { stream: s, read: () => chunks.join("") };
}

test("streamSections in non-animate mode is byte-identical to join+newline", async () => {
  const { stream, read } = makeStream(false);
  await streamSections(["A", "B", "C"], { stream, animate: false });
  assert.equal(read(), "A\n\nB\n\nC\n");
});

test("streamSections respects custom separator in non-animate mode", async () => {
  const { stream, read } = makeStream(false);
  await streamSections(["A", "B"], { stream, animate: false, separator: " | " });
  assert.equal(read(), "A | B\n");
});

test("streamSections in animate mode produces same final bytes after settle", async () => {
  const { stream, read } = makeStream(true);
  await streamSections(["A", "B", "C"], {
    stream,
    animate: true,
    delayMs: 1,
  });
  assert.equal(read(), "A\n\nB\n\nC\n");
});

test("streamSections animate mode actually waits between sections", async () => {
  const { stream } = makeStream(true);
  const t0 = Date.now();
  await streamSections(["A", "B", "C", "D"], {
    stream,
    animate: true,
    delayMs: 30,
  });
  const elapsed = Date.now() - t0;
  // 3 inter-section delays of 30ms = 90ms minimum.
  assert.ok(elapsed >= 80, `expected >=80ms, got ${elapsed}ms`);
});

test("streamSections handles empty array as no-op", async () => {
  const { stream, read } = makeStream(true);
  await streamSections([], { stream, animate: true, delayMs: 10 });
  assert.equal(read(), "");
});

test("shouldAnimate respects NO_ANIMATE env", () => {
  const stream = { isTTY: true } as NodeJS.WriteStream;
  const prev = process.env.NO_ANIMATE;
  process.env.NO_ANIMATE = "1";
  try {
    assert.equal(shouldAnimate(stream, false), false);
  } finally {
    if (prev === undefined) delete process.env.NO_ANIMATE;
    else process.env.NO_ANIMATE = prev;
  }
});

test("shouldAnimate respects --no-animate flag", () => {
  const stream = { isTTY: true } as NodeJS.WriteStream;
  assert.equal(shouldAnimate(stream, true), false);
});

test("shouldAnimate is false when stream is not a TTY", () => {
  const stream = { isTTY: false } as NodeJS.WriteStream;
  assert.equal(shouldAnimate(stream, false), false);
});

test("shouldAnimate is true when TTY and not opted out", () => {
  const stream = { isTTY: true } as NodeJS.WriteStream;
  const prev = process.env.NO_ANIMATE;
  delete process.env.NO_ANIMATE;
  try {
    assert.equal(shouldAnimate(stream, false), true);
  } finally {
    if (prev !== undefined) process.env.NO_ANIMATE = prev;
  }
});
