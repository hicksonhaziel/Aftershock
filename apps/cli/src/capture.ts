import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { captureConfigSchema, type CaptureManifest } from "@aftershock/contracts";
import { CaptureWriter } from "@aftershock/capture";
import { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { GrpcClient, type DuplexStream } from "@triton-one/yellowstone-grpc/napi";
import bs58 from "bs58";
import { validEndpoint, verifyRpc } from "./rpc.js";

let stream: DuplexStream | undefined;
let writer: CaptureWriter | undefined;
let durationTimer: NodeJS.Timeout | undefined;
const state: { stopReason: CaptureManifest["stopReason"] | undefined } = { stopReason: undefined };
const stop = (reason: CaptureManifest["stopReason"]) => {
  state.stopReason ??= reason;
  stream?.close();
};
const onSignal = () => stop("cancelled");
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
const setupTimer = setTimeout(() => {
  console.error("Capture setup timed out; credentials withheld.");
  process.exit(2);
}, 50_000);

try {
  if (existsSync(".env")) loadEnvFile(".env");
  const config = captureConfigSchema.parse(JSON.parse(readFileSync(process.argv[2] || "config/capture.example.json", "utf8")));
  for (const address of config.accountInclude) if (bs58.decode(address).length !== 32) throw new Error("Invalid account.");
  const endpoint = process.env.SOLAMI_STREAM_URL?.trim() || "https://grpc.solami.dev";
  const token = process.env.SOLAMI_STREAM_TOKEN?.trim() || process.env.SOLAMI_API_KEY?.trim();
  if (!validEndpoint(endpoint) || !token) throw new Error("Invalid streaming configuration.");
  await verifyRpc(process.env.SOLAMI_RPC_URL ?? "");
  if (state.stopReason) throw new Error("Cancelled during setup.");
  const client = await GrpcClient.new(endpoint, token, { grpcMaxDecodingMessageSize: 2 * 1024 * 1024 }, { enabled: false });
  const request = SubscribeRequest.fromPartial({
    transactions: { aftershock: { vote: false, failed: false, accountInclude: config.accountInclude } },
    commitment: config.commitment === "finalized" ? CommitmentLevel.FINALIZED : CommitmentLevel.CONFIRMED,
  });
  stream = await client.subscribe(Buffer.from(SubscribeRequest.encode(request).finish()));
  writer = new CaptureWriter(process.env.AFTERSHOCK_DATA_DIR || ".aftershock", config);
  clearTimeout(setupTimer);
  durationTimer = setTimeout(() => stop("duration"), config.durationSeconds * 1000);
  let transactions = 0;
  let frames = 0;
  console.log(`Capturing up to ${config.maxTransactions} transactions for ${config.durationSeconds}s.`);
  try {
    while (!state.stopReason) {
      const raw = await stream.read();
      if (state.stopReason) break;
      if (!raw) { stop("stream-ended"); break; }
      const sequence = writer.append(raw);
      if (sequence === null) { stop("byte-limit"); break; }
      frames++;
      let update: SubscribeUpdate;
      try { update = SubscribeUpdate.decode(raw); }
      catch { stop("decode-error"); break; }
      if (update.transaction) {
        const info = update.transaction.transaction;
        const message = info?.transaction?.message;
        const meta = info?.meta;
        if (!info || !message || !meta || info.signature.length !== 64) { stop("decode-error"); break; }
        const keys = [...message.accountKeys, ...meta.loadedWritableAddresses, ...meta.loadedReadonlyAddresses].map(key => bs58.encode(key));
        if (info.isVote || meta.err || !config.accountInclude.some(address => keys.includes(address))) { stop("filter-mismatch"); break; }
        writer.classify(sequence, { kind: "transaction", slot: update.transaction.slot, signature: bs58.encode(info.signature) });
        transactions++;
      } else {
        writer.classify(sequence, { kind: "control" });
        if (update.ping) await stream.writeRaw(Buffer.from(SubscribeRequest.encode(SubscribeRequest.fromPartial({ ping: { id: 1 } })).finish()));
      }
      if (transactions >= config.maxTransactions) stop("transaction-limit");
      else if (frames >= config.maxFrames) stop("frame-limit");
    }
  } catch { stop("stream-error"); }
  const { manifest, manifestHash } = writer.seal(state.stopReason ?? "stream-ended", state.stopReason === "byte-limit");
  console.log(`Capture: ${manifest.captureId}`);
  console.log(`Received: ${manifest.transactions} transactions; ${manifest.rawBytes} raw bytes.`);
  console.log(`Stopped: ${manifest.stopReason}. Reference coverage: not assessed.`);
  console.log(`Manifest SHA-256: ${manifestHash}`);
  console.log(`Local evidence: ${writer.directory}`);
  if (["stream-error", "decode-error", "filter-mismatch"].includes(manifest.stopReason)) process.exitCode = 2;
  else if (!manifest.transactions || manifest.stopReason === "cancelled" || manifest.stopReason === "stream-ended") process.exitCode = 3;
} catch {
  console.error("Capture failed during setup or storage. Check configuration and local disk; upstream details withheld.");
  if (writer) console.error(`Unsealed evidence: ${writer.directory}`);
  process.exitCode = 2;
} finally {
  clearTimeout(setupTimer);
  clearTimeout(durationTimer);
  stream?.close();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}
