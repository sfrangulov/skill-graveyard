import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./cli.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
    version: string;
  }
).version;

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(env)) {
      const orig = original[key];
      if (orig === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = orig;
      }
    }
  }
}

function withTTY<T>(isTTY: boolean, fn: () => T): T {
  const original = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", {
    value: isTTY,
    configurable: true,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", {
      value: original,
      configurable: true,
    });
  }
}

test("NO_COLOR=1 disables color even on a TTY", () => {
  withEnv({ NO_COLOR: "1" }, () => {
    withTTY(true, () => {
      const args = parseArgs([]);
      assert.equal(args.color, false);
    });
  });
});

test("NO_COLOR with any non-empty value disables color on a TTY", () => {
  withEnv({ NO_COLOR: "true" }, () => {
    withTTY(true, () => {
      const args = parseArgs([]);
      assert.equal(args.color, false);
    });
  });
});

test("NO_COLOR='' (empty string) does not disable color", () => {
  withEnv({ NO_COLOR: "" }, () => {
    withTTY(true, () => {
      const args = parseArgs([]);
      assert.equal(args.color, true);
    });
  });
});

test("NO_COLOR unset on a TTY keeps color enabled", () => {
  withEnv({ NO_COLOR: undefined }, () => {
    withTTY(true, () => {
      const args = parseArgs([]);
      assert.equal(args.color, true);
    });
  });
});

test("Explicit --color overrides NO_COLOR", () => {
  withEnv({ NO_COLOR: "1" }, () => {
    withTTY(true, () => {
      const args = parseArgs(["--color"]);
      assert.equal(args.color, true);
    });
  });
});

test("Explicit --no-color disables color regardless of env", () => {
  withEnv({ NO_COLOR: undefined }, () => {
    withTTY(true, () => {
      const args = parseArgs(["--no-color"]);
      assert.equal(args.color, false);
    });
  });
});

test("Non-TTY stdout keeps color disabled even without NO_COLOR", () => {
  withEnv({ NO_COLOR: undefined }, () => {
    withTTY(false, () => {
      const args = parseArgs([]);
      assert.equal(args.color, false);
    });
  });
});

test("--version reports the version from package.json", () => {
  // Regression for the 0.6.1 mishap where the version string was hardcoded
  // and quietly drifted from the published package.json. Spawn the actual
  // CLI binary so we exercise the same code path users hit.
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "--version"],
    { encoding: "utf-8", cwd: REPO_ROOT },
  );
  assert.equal(result.status, 0, `cli exited non-zero: ${result.stderr}`);
  assert.equal(result.stdout.trim(), `skill-graveyard ${PKG_VERSION}`);
});
