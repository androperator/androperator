import { shouldCliStdoutForceExitCode1 } from "../../cli/stdoutExitCode.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectCompactSnapshot, presentSnapshot } from "../../domain/observe/compactSnapshot.js";
import { cmdObserveSnapshot } from "../../cli/commands/observe.js";
import { buildSnapshotSuccessResult, getCoreMcpTools } from "../../mcp/tools/core.js";
import { buildMcpSuccessResult } from "../../mcp/errors.js";
import type { ResultEnvelope } from "../../contracts/result.js";

const ids = { commandId: "capture", taskId: "task" };
const xml = `<?xml version="1.0"?><hierarchy><node class="Container" text=""><node resource-id="repeat" text="A&amp;B 😀é" content-desc="&quot;label&quot;" checked="false" checkable="true" selected="false" enabled="true" clickable="false" scrollable="false" visible-to-user="false" accessibility-data-sensitive="true" bounds="[0,0][1,1]"/><node resource-id="repeat" text="" checked="true" mystery="ignored"/></node></hierarchy>`;
const envelope = (text = xml): ResultEnvelope => ({ ...ids, status: "success", stepResults: [
  { id: "snap", actionType: "snapshot", success: true, data: { text, operator_overlay_visible: "true", window_count: "2" } },
] });

describe("compact snapshot", () => {
  it("keeps containers, repeated ids, all states, escaping and capture-local ancestry", () => {
    const result = projectCompactSnapshot(xml, ids);
    assert.equal(result.totalNodes, 3);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.nodes.map(node => [node.nodePath, node.parentPath]), [["0", null], ["0.0", "0"], ["0.1", "0"]]);
    assert.deepEqual(result.nodes[1], {
      nodePath: "0.0", parentPath: "0", resourceId: "repeat", className: null,
      text: "A&B 😀é", contentDescription: '"label"', bounds: "[0,0][1,1]",
      textTruncated: false, contentDescriptionTruncated: false,
      checked: false, checkable: true, selected: false, enabled: true, clickable: false,
      scrollable: false, visibleToUser: false, accessibilityDataSensitive: true,
    });
    assert.equal(result.nodes[2].visibleToUser, null);
    assert.equal(result.nodes[2].text, "");
    assert.equal(result.nodes[2].checked, true);
  });
  it("preserves literal label whitespace, entities, and code point budgets", async () => {
    const text = "First\nSecond\tcolumn\r\n😀&\"end";
    const description = "Description\rline\nnext\t'é";
    const raw = `<hierarchy><!-- text="ignored\nvalue" -->
<node text="First\nSecond\tcolumn\r\n😀&amp;&quot;end" content-desc='Description\rline\nnext\t&apos;é'/>
<node text="plain" content-desc="&#10;&#9;&#13;&amp;#10;"/></hierarchy>`;
    const result = projectCompactSnapshot(raw, ids);
    assert.equal(result.nodes[0].text, text);
    assert.equal(result.nodes[0].contentDescription, description);
    assert.equal(result.nodes[1].text, "plain");
    assert.equal(result.nodes[1].contentDescription, "\n\t\r&#10;");
    assert.equal(result.truncated, false);
    const limited = projectCompactSnapshot(raw, ids, { maxTextChars: 7 });
    assert.equal(limited.nodes[0].text, "First\nS");
    assert.equal(limited.nodes[0].textTruncated, true);
    const cli = JSON.parse(await cmdObserveSnapshot({ format: "json", compact: true,
      tryDaemonExecutionFn: async () => ({ ok: true, envelope: envelope(raw), deviceId: "test-device", terminalSource: "androperator_result" }),
    }));
    const presentation = await presentSnapshot(envelope(raw), { compact: true });
    const mcp = buildSnapshotSuccessResult({ envelope: presentation.envelope }, presentation);
    assert.deepEqual(cli.compact, mcp.structuredContent!.compact);
    assert.equal(cli.compact.nodes[0].text, text);
  });
  it("counts the full tree but returns a whole-node preorder prefix and Unicode code points", () => {
    const result = projectCompactSnapshot(xml, ids, { maxNodes: 2, maxTextChars: 5 });
    assert.equal(result.returnedNodes, 2);
    assert.equal(result.omittedNodes, 1);
    assert.equal(result.nodes[1].text, "A&B 😀");
    assert.equal(result.nodes[1].textTruncated, true);
    assert.equal(result.nodes[1].contentDescriptionTruncated, true);
    assert.equal(result.truncated, true);
    const large = projectCompactSnapshot(`<hierarchy><node>${'<node/>'.repeat(1500)}</node></hierarchy>`, ids);
    assert.equal(large.totalNodes, 1501);
    assert.equal(large.returnedNodes, 100);
    assert.equal(large.omittedNodes, 1401);
  });
  for (const badXml of ["", "<hierarchy><node></hierarchy>", '<hierarchy><node text="&unknown;"/></hierarchy>',
    '<!DOCTYPE hierarchy SYSTEM "file:///private/example"><hierarchy/>',
    '<!DOCTYPE hierarchy [<!ENTITY x "expanded">]><hierarchy><node text="&x;"/></hierarchy>',
    '<hierarchy><node/><node broken="x></node></hierarchy>', '<wrong/>', '<hierarchy>text</hierarchy>']) {
    it(`rejects malformed or prohibited XML ${badXml.slice(0, 45)}`, () => {
      assert.throws(() => projectCompactSnapshot(badXml, ids, { maxNodes: 1 }), { code: "SNAPSHOT_EXTRACTION_FAILED" });
    });
  }
  it("preserves exact raw bytes, original envelope, and metadata; never overwrites files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "compact-test-"));
    try {
      const rawPath = join(directory, "raw.xml");
      const original = envelope(xml + "\n");
      const result = await presentSnapshot(original, { compact: true, rawPath });
      assert.equal(await readFile(rawPath, "utf8"), xml + "\n");
      assert.equal(original.stepResults[0].data.text, xml + "\n");
      assert.deepEqual(result.envelope.stepResults[0].data, { operator_overlay_visible: "true", window_count: "2" });
      await assert.rejects(presentSnapshot(original, { compact: true, rawPath }), (error: any) => {
        assert.equal(error.code, "SNAPSHOT_ARTIFACT_WRITE_FAILED");
        assert.equal(error.envelope, original);
        return true;
      });
      assert.equal(await readFile(rawPath, "utf8"), xml + "\n");
      const brokenPath = join(directory, "broken.xml");
      await assert.rejects(presentSnapshot(envelope("<broken"), { compact: true, rawPath: brokenPath }), (error: any) => {
        assert.equal(error.code, "SNAPSHOT_EXTRACTION_FAILED");
        assert.equal(error.rawArtifactPath, brokenPath);
        return true;
      });
      assert.equal(await readFile(brokenPath, "utf8"), "<broken");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("shares CLI/MCP projection and exposes only trusted snapshot output paths", async () => {
    const original = envelope();
    const result = await presentSnapshot(original, { compact: true, saveRaw: true });
    const path = result.compact!.rawArtifactPath!;
    try {
      const cli = JSON.parse(await cmdObserveSnapshot({ format: "json", compact: true,
        tryDaemonExecutionFn: async () => ({ ok: true, envelope: original, deviceId: "test-device", terminalSource: "androperator_result" }),
      }));
      const mcp = buildSnapshotSuccessResult({ envelope: result.envelope }, result);
      assert.deepEqual(JSON.parse(mcp.content[0].text), mcp.structuredContent);
      const { rawArtifactPath, ...compact } = result.compact!;
      assert.deepEqual(cli.compact, compact);
      assert.equal((mcp.structuredContent!.compact as any).nodes[0].nodePath, "0");
      assert.equal(await readFile(path, "utf8"), xml);
      assert.ok(!JSON.stringify(mcp).includes("<?xml"));
      assert.deepEqual(buildMcpSuccessResult({ rawArtifactPath: "/private", nodePath: "/private" }).structuredContent, {});
    } finally { await rm(path, { force: true }); }
  });
  it("fails CLI presentation without replacing the successful execution verdict", async () => {
    const original = envelope();
    const result = await cmdObserveSnapshot({ format: "json", compact: true, rawPath: "/missing-parent/snapshot.xml",
      tryDaemonExecutionFn: async () => ({ ok: true, envelope: original, deviceId: "test-device", terminalSource: "androperator_result" }),
    });
    assert.equal(JSON.parse(result).code, "SNAPSHOT_ARTIFACT_WRITE_FAILED");
    assert.equal(JSON.parse(result).envelope.status, "success");
    assert.equal(shouldCliStdoutForceExitCode1(result, false), true);
    assert.equal(shouldCliStdoutForceExitCode1(JSON.stringify({ code: "SNAPSHOT_EXTRACTION_FAILED", envelope: original }), false), true);
  });
  it("keeps default CLI output unchanged and validates before dispatch", async () => {
    const original = envelope();
    const raw = JSON.parse(await cmdObserveSnapshot({ format: "json", tryDaemonExecutionFn: async () => ({
      ok: true, envelope: original, deviceId: "test-device", terminalSource: "androperator_result",
    }) }));
    assert.deepEqual(raw, { envelope: original, deviceId: "test-device", terminalSource: "androperator_result", isCanonicalTerminal: true });
    for (const options of [{ maxNodes: 1 }, { compact: true, maxNodes: 0 }, { compact: true, maxTextChars: 4097 }, { rawPath: " " }]) {
      const value = JSON.parse(await cmdObserveSnapshot({ format: "json", ...options, tryDaemonExecutionFn: async () => { throw new Error("must not dispatch"); } }));
      assert.equal(value.code, "USAGE");
    }
  });
  it("returns nonzero structured CLI usage errors for missing and invalid values with global output options in either placement", () => {
    for (const args of [["--max-nodes"], ["--compact", "--max-nodes", "0"], ["--compact", "--max-nodes", "1001"],
      ["--max-nodes", "1"], ["--compact", "--max-nodes", "1.5"], ["--compact", "--max-text-chars", "NaN"],
      ["--compact", "--max-text-chars"], ["--raw-path"], ["--raw-path", " "], ["--compact", "--max-text-chars", "4097"]]) {
      for (const command of [["snapshot", "--output", "json", ...args], ["--output", "json", "snapshot", ...args]]) {
        const child = spawnSync(process.execPath, ["dist/cli/index.js", ...command], { encoding: "utf8" });
        assert.equal(child.status, 1, JSON.stringify(command));
        assert.equal(JSON.parse(child.stdout).code, "USAGE", child.stdout);
      }
    }
  });
  it("rejects incompatible MCP options and arbitrary rawPath before execution", async () => {
    const tool = getCoreMcpTools().find(tool => tool.name === "snapshot")!;
    for (const args of [{ compact: true, maxChars: 1 }, { maxNodes: 1 }, { maxTextChars: 1 }, { rawPath: "/tmp/output" }, { saveRaw: "yes" }]) {
      await assert.rejects(async () => tool.handler(args), (error: any) => error.code === -32602);
    }
  });
});

it("does not expose raw parser messages from compact presentation", () => {
  assert.throws(() => projectCompactSnapshot('<hierarchy><node private="secret"/></private_secret>', ids), (error: unknown) => {
    const failure = error as { code: string; message: string };
    assert.equal(failure.code, 'SNAPSHOT_EXTRACTION_FAILED');
    assert.equal(failure.message, 'Cannot project snapshot into compact presentation');
    assert.ok(!JSON.stringify(failure).includes('secret'));
    return true;
  });
});
