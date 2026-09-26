import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { CaptureWriter } from "@aftershock/capture";
import bs58 from "bs58";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("offline audit distinguishes matching, discrepant, missing and tampered evidence", { timeout: 60_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "aftershock-audit-"));
  try {
    const key = new Uint8Array(32).fill(2), sig = new Uint8Array(64).fill(3), address = bs58.encode(key), signature = bs58.encode(sig);
    const header = { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 };
    const writer = new CaptureWriter(root, { schemaVersion: 1, accountInclude: [address], commitment: "confirmed", maxTransactions: 1, maxFrames: 2, maxBytes: 4096, durationSeconds: 1 });
    const raw = SubscribeUpdate.encode(SubscribeUpdate.fromPartial({ transaction: { slot: "10", transaction: { signature: sig,
      transaction: { signatures: [sig], message: { header, accountKeys: [key], recentBlockhash: key } }, meta: {} } } })).finish();
    const sequence = writer.append(raw)!;
    writer.classify(sequence, { kind: "transaction", slot: "10", signature });
    const { manifest, manifestHash } = writer.seal("transaction-limit");
    const referenceDirectory = join(root, "reference"); mkdirSync(referenceDirectory);
    const entry = { version: "legacy", transaction: { signatures: [signature], message: { header, accountKeys: [address], recentBlockhash: address, instructions: [] } }, meta: { err: null } };
    function reference(entries: unknown[]) {
      const response = JSON.stringify({ result: { transactions: entries } });
      writeFileSync(join(referenceDirectory, "response-0.json"), response);
      const report = JSON.stringify({ schemaVersion: 1, parentCaptureId: manifest.captureId, parentManifestSha256: manifestHash,
        reconstruction: { scope: "full-filtered-finalized-blocks" }, requests: [{ status: "received", method: "getBlock", file: "response-0.json",
          params: [10, { commitment: "finalized", transactionDetails: "full", encoding: "json" }], bytes: Buffer.byteLength(response), sha256: hash(response) }] });
      writeFileSync(join(referenceDirectory, "reference.json"), report);
      writeFileSync(join(referenceDirectory, "reference.sha256"), hash(report));
    }
    function run() {
      return spawnSync(process.execPath, ["--import", "tsx", resolve("apps/cli/src/compatibility-check.ts"), writer.directory, referenceDirectory], {
        encoding: "utf8", timeout: 10_000, env: { ...process.env, AFTERSHOCK_DATA_DIR: root },
      });
    }
    reference([entry]); assert.equal(run().status, 0);
    entry.transaction.message.accountKeys = [bs58.encode(new Uint8Array(32).fill(4))];
    reference([entry]); assert.equal(run().status, 1);
    reference([]); assert.equal(run().status, 3);
    writeFileSync(join(referenceDirectory, "response-0.json"), "{}");
    assert.equal(run().status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
