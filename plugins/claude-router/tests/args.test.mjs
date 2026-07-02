import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../scripts/lib/args.mjs";

test("parseArgs preserves inline values containing equals", () => {
  const parsed = parseArgs(["--append-system-prompt=A=B", "prompt"], {
    valueOptions: ["append-system-prompt"]
  });

  assert.equal(parsed.options["append-system-prompt"], "A=B");
  assert.deepEqual(parsed.positionals, ["prompt"]);
});

test("parseArgs preserves repeatable option values", () => {
  const parsed = parseArgs(["--allowed-tools", "Read", "--allowed-tools", "Bash(git *)", "prompt"], {
    valueOptions: ["allowed-tools"],
    repeatableOptions: ["allowed-tools"]
  });

  assert.deepEqual(parsed.options["allowed-tools"], ["Read", "Bash(git *)"]);
  assert.deepEqual(parsed.positionals, ["prompt"]);
});

test("parseArgs supports optional-value flags without consuming the only prompt", () => {
  const bare = parseArgs(["--debug", "inspect"], {
    optionalValueOptions: ["debug"]
  });
  const valued = parseArgs(["--debug", "router", "inspect"], {
    optionalValueOptions: ["debug"]
  });
  const inline = parseArgs(["--debug=router", "inspect"], {
    optionalValueOptions: ["debug"]
  });

  assert.equal(bare.options.debug, true);
  assert.deepEqual(bare.positionals, ["inspect"]);
  assert.equal(valued.options.debug, "router");
  assert.deepEqual(valued.positionals, ["inspect"]);
  assert.equal(inline.options.debug, "router");
  assert.deepEqual(inline.positionals, ["inspect"]);
});
