import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { CaptureWriter, verifyCapture } from "../src/index.js";
import { captureConfigSchema } from "@aftershock/contracts";

const config = captureConfigSchema.parse({ schemaVersion: 1,
  accountInclude: ["11111111111111111111111111111111"], commitment: "confirmed",
  maxTransactions: 2, maxFrames: 3, maxBytes: 1024, durationSeconds: 1 });
function setup(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "aftershock-capture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new CaptureWriter(root, config);
}

test("raw bytes survive storage; an interrupted capture has no seal", t => {
  const writer = setup(t);
  const raw = Buffer.from([0, 255, 128, 1, 42]);
  writer.append(raw);
  assert.deepEqual(gunzipSync(readFileSync(join(writer.directory, "frame-0.pb.gz"))), raw);
  assert.equal(existsSync(join(writer.directory, "manifest.json")), false);
  assert.throws(() => verifyCapture(writer.directory));
  writer.classify(0, { kind: "control" });
  writer.seal("duration");
  assert.equal(verifyCapture(writer.directory).manifest.rawBytes, raw.length);
  assert.throws(() => writer.append(raw), /sealed/);
  assert.throws(() => writer.seal("duration"), /sealed/);
});

test("tampered compressed data is rejected", t => {
  const writer = setup(t);
  writer.append(Buffer.from("synthetic")); writer.seal("duration");
  writeFileSync(join(writer.directory, "frame-0.pb.gz"), "corrupted");
  assert.throws(() => verifyCapture(writer.directory), /integrity/);
});

test("tampered manifest is rejected", t => {
  const writer = setup(t); writer.seal("duration");
  const path = join(writer.directory, "manifest.json");
  writeFileSync(path, readFileSync(path, "utf8") + " ");
  assert.throws(() => verifyCapture(writer.directory), /hash mismatch/);
});

test("byte limit retains earlier evidence and records rejected frame", t => {
  const writer = setup(t);
  assert.equal(writer.append(Buffer.alloc(1000)), 0);
  assert.equal(writer.append(Buffer.alloc(25)), null);
  writer.seal("byte-limit", true);
  const { manifest } = verifyCapture(writer.directory);
  assert.equal(manifest.rawBytes, 1000);
  assert.equal(manifest.discardedFrameAtByteLimit, true);
  assert.equal(manifest.intervalCompleteness, "not-established");
});

test("unfiltered capture configurations are rejected", () => {
  assert.equal(captureConfigSchema.safeParse({ ...config, accountInclude: [] }).success, false);
});

test("provider replay is labelled separately and retains the requested slot", t => {
  const root = mkdtempSync(join(tmpdir(), "aftershock-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const writer = new CaptureWriter(root, { ...config, fromSlot: "123" });
  writer.append(Buffer.from("synthetic"));
  writer.seal("duration");
  const { manifest } = verifyCapture(writer.directory);
  assert.equal(manifest.source, "provider-replay");
  assert.equal(manifest.config.fromSlot, "123");
});
