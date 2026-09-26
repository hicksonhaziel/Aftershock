import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { CaptureWriter } from "@aftershock/capture";
import bs58 from "bs58";
test("pinned consumer export rejects v1 unless exclusions are explicitly recorded", { timeout: 30_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "aftershock-replay-"));
  try {
    const key = new Uint8Array(32).fill(2), sig = new Uint8Array(64).fill(3);
    const writer = new CaptureWriter(root, { schemaVersion: 1, accountInclude: [bs58.encode(key)], commitment: "confirmed", maxTransactions: 2, maxFrames: 2, maxBytes: 4096, durationSeconds: 1 });
    for (const v1 of [false, true]) {
      const raw = SubscribeUpdate.encode(SubscribeUpdate.fromPartial({ transaction: { slot: "10", transaction: { signature: sig,
        transaction: { signatures: [sig], message: { accountKeys: [key], versioned: v1, ...(v1 ? { config: { computeUnitLimit: 1 } } : {}) } }, meta: {} } } })).finish();
      const sequence = writer.append(raw)!;
      writer.classify(sequence, { kind: "transaction", slot: "10", signature: bs58.encode(sig) });
    }
    writer.seal("transaction-limit");
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", resolve("apps/cli/src/export-replay.ts"), writer.directory, ...args], { timeout: 10_000, encoding: "utf8", env: { ...process.env, AFTERSHOCK_DATA_DIR: root } });
    assert.equal(run([]).status, 2);
    assert.equal(run(["--legacy-v0-only"]).status, 0);
    const directory = join(root, "replay-inputs", readdirSync(join(root, "replay-inputs"))[0]!);
    const report = JSON.parse(readFileSync(join(directory, "replay-input.json"), "utf8"));
    assert.equal(report.mapping.length, 1);
    assert.equal(report.exclusions.length, 1);
    assert.equal(report.exclusions[0].sourceSequence, 1);
    assert.equal(report.controlFramesExcluded, 0);
    assert.equal(readFileSync(join(directory, "transactions.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
