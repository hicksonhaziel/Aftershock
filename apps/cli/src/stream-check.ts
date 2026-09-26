import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { GrpcClient, type DuplexStream } from "@triton-one/yellowstone-grpc/napi";
import { validEndpoint } from "./rpc.js";

// Bounded connectivity probe, not the production capture worker.
let stream: DuplexStream | undefined;
const timeout = setTimeout(() => {
  stream?.close();
  console.error("Streaming probe timed out after 20 seconds; details withheld.");
  process.exit(2);
}, 20_000);

try {
  if (existsSync(".env")) loadEnvFile(".env");
  const endpoint = process.env.SOLAMI_STREAM_URL?.trim() || "https://grpc.solami.dev";
  const token = process.env.SOLAMI_STREAM_TOKEN?.trim() || process.env.SOLAMI_API_KEY?.trim();
  if (!validEndpoint(endpoint) || !token) throw new Error("configuration");
  const client = await GrpcClient.new(endpoint, token, {
    grpcMaxDecodingMessageSize: 65_536,
  }, { enabled: false });
  const request = SubscribeRequest.fromPartial({
    slots: { probe: { filterByCommitment: true } },
    commitment: CommitmentLevel.CONFIRMED,
  });
  stream = await client.subscribe(Buffer.from(SubscribeRequest.encode(request).finish()));
  const directory = join(process.env.AFTERSHOCK_DATA_DIR || ".aftershock", "probes", randomUUID());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const frames: { file: string; sha256: string; bytes: number; receivedAt: string; slot?: string }[] = [];
  let slots = 0;
  let bytes = 0;
  while (frames.length < 20 && slots < 3) {
    const raw = await stream.read();
    if (!raw) break;
    bytes += raw.length;
    if (bytes > 262_144) throw new Error("byte limit");
    const file = `frame-${frames.length}.bin`;
    // Persist the received protobuf bytes before decoding them.
    writeFileSync(join(directory, file), raw, { flag: "wx", mode: 0o600 });
    const update = SubscribeUpdate.decode(raw);
    frames.push({ file, sha256: createHash("sha256").update(raw).digest("hex"), bytes: raw.length,
      receivedAt: new Date().toISOString(), ...(update.slot ? { slot: update.slot.slot } : {}) });
    if (update.slot) slots++;
  }
  stream.close();
  writeFileSync(join(directory, "probe.json"), JSON.stringify({
    schemaVersion: 1, purpose: "stream-connectivity-probe", provider: "solami",
    transport: "yellowstone", sdkVersion: "7.0.1", commitment: "confirmed",
    request: SubscribeRequest.toJSON(request), slots, bytes, frames,
    completeness: "not-assessed", transactionCapture: false,
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Streaming probe: ${slots >= 3 ? "passed" : "incomplete"}; ${slots} slot updates, ${bytes} protobuf bytes.`);
  console.log(`Local evidence: ${directory}`);
  if (slots < 3) process.exitCode = 3;
} catch {
  console.error("Streaming probe failed. Check endpoint, key permissions, entitlement, and connectivity; details withheld.");
  process.exitCode = 2;
} finally {
  clearTimeout(timeout);
  stream?.close();
}
