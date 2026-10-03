import { describe, it } from "node:test";
import assert from "node:assert";
import { readAllRequiresJsonOutputError } from "../../cli/registry.js";

describe("readAllRequiresJsonOutputError", () => {
  it("returns undefined for default json output", () => {
    assert.strictEqual(
      readAllRequiresJsonOutputError({ command: "read", format: "json" }),
      undefined,
    );
  });

  it("errors when format is pretty", () => {
    const out = readAllRequiresJsonOutputError({
      command: "read",
      format: "pretty",
    });
    assert.ok(out);
    assert.match(out, /read --all requires JSON output/i);
    assert.match(out, /do not use --output pretty/i);
    const parsed = JSON.parse(out) as { message: string };
    assert.match(parsed.message, /androperator read --text "Price" --all/);
  });
});
