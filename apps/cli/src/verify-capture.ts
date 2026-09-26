import { verifyCapture } from "@aftershock/capture";

try {
  if (!process.argv[2]) throw new Error("Missing directory.");
  const { manifest, manifestHash } = verifyCapture(process.argv[2]);
  console.log(`Integrity verified: ${manifest.captureId}`);
  console.log(`${manifest.transactions} transactions, ${manifest.frames.length} frames, ${manifest.rawBytes} raw bytes.`);
  console.log(`Manifest SHA-256: ${manifestHash}`);
  console.log("This verifies stored bytes, not chain completeness or consumer correctness.");
} catch {
  console.error("Capture integrity verification failed. Supply a sealed capture directory; check for missing or changed files.");
  process.exitCode = 2;
}
