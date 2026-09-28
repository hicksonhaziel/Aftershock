import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CaptureWriter, verifyCapture } from "../../capture/src/index.js";
import { captureConfigSchema } from "@aftershock/contracts";
import { checkFinalizedMembership } from "../../reference/src/index.js";
import { inspectReference } from "../src/reference-evidence.js";
import { digest, json } from "../src/regression.js";

test("recorded full-filter evidence reconstructs independently; unavailable blocks stay unresolved and corruption fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aftershock-reference-test-"));
  try {
    const account = "1".repeat(32), signature = "1".repeat(64);
    const writer = new CaptureWriter(directory, captureConfigSchema.parse({ schemaVersion: 1, accountInclude: [account], commitment: "confirmed", maxTransactions: 2, maxFrames: 3, maxBytes: 1024, durationSeconds: 1 }));
    writer.append(Buffer.from("synthetic reference fixture")); writer.classify(0, { kind: "transaction", slot: "10", signature }); writer.seal("duration");
    const { manifest, manifestHash } = verifyCapture(writer.directory);
    const block = { blockhash: account, transactions: [{ version: "legacy", transaction: { signatures: [signature], message: { accountKeys: [account], instructions: [] } }, meta: { err: null } }] };
    for (const available of [true, false]) {
      const requests: any[] = [];
      function save(method: string, params: unknown[], result: unknown) {
        const file = `response-${requests.length}.json`, bytes = json({ jsonrpc: "2.0", id: 1, result }); writeFileSync(join(directory, file), bytes);
        requests.push({ method, params, status: "received", file, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) });
      }
      save("getSlot", [{ commitment: "finalized" }], 10);
      const result = await checkFinalizedMembership([{ slot: "10", signature }], "10", async (method, params) => {
        if (method === "getBlocks") { save(method, params, [10]); return [10]; }
        const full = [10, { commitment: "finalized", encoding: "json", transactionDetails: "full", maxSupportedTransactionVersion: 1, rewards: false }];
        save(method, full, available ? block : null);
        if (!available) throw new Error();
        return { blockhash: account, signatures: [signature] };
      });
      const report = { schemaVersion: 1, parentCaptureId: manifest.captureId, parentManifestSha256: manifestHash, requests, result,
        reconstruction: { predicate: manifest.predicate, matchingTransactions: available ? [{ slot: "10", signature }] : [], notObservedInCapture: [] } };
      const bytes = json(report); writeFileSync(join(directory, "reference.json"), bytes); writeFileSync(join(directory, "reference.sha256"), digest(bytes));
      const check = await inspectReference(directory, manifest, manifestHash);
      assert.equal(check.verdict, available ? "PASS" : "INCONCLUSIVE");
      assert.equal(check.transactions[0]!.status, available ? "present" : "unresolved");
      await assert.rejects(inspectReference(directory, manifest, "a".repeat(64)), /parent/);
      writeFileSync(join(directory, "response-0.json"), "corrupt");
      await assert.rejects(inspectReference(directory, manifest, manifestHash), /hash/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
