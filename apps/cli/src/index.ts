import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { verdictSchema } from "@aftershock/contracts";
import { validEndpoint, verifyRpc } from "./rpc.js";

const command = process.argv[2];
if (command !== "doctor" && command !== "rpc-check") {
  console.error("Usage: pnpm run doctor | pnpm rpc:check");
  process.exitCode = 2;
} else {
  try {
    if (existsSync(".env")) loadEnvFile(".env");
    const endpoint = process.env.SOLAMI_RPC_URL?.trim();
    if (command === "rpc-check") {
      try {
        const result = await verifyRpc(endpoint ?? "");
        console.log(`Cluster verified: ${result.cluster}`);
        console.log(`Finalized slot: ${result.finalizedSlot}`);
      } catch (error) {
        // verifyRpc only throws controlled messages without upstream bodies or URLs.
        console.error((error as Error).message);
        process.exitCode = 2;
      }
    } else {
      const [major, minor] = process.versions.node.split(".").map(Number);
      const supportedNode = major === 22 && (minor ?? 0) >= 22;
      const valid = validEndpoint(endpoint);
      console.log(`Node.js: ${supportedNode ? "supported" : "unsupported (use Node 22.22+)"}`);
      console.log(`Shared contracts: loaded (${verdictSchema.options.length} verdicts)`);
      console.log(`Solami RPC configuration: ${valid ? "valid HTTPS URL" : endpoint ? "invalid; use the full HTTPS endpoint URL" : "missing"}`);
      console.log("Provider connectivity: not tested (use pnpm rpc:check)");
      console.log("Bounded capture: available (pnpm capture); consumer execution: not implemented yet");
      if (!supportedNode || (endpoint && !valid)) process.exitCode = 2;
      else if (!endpoint) process.exitCode = 3;
    }
  } catch {
    console.error("Could not load local configuration. Check .env syntax and permissions.");
    process.exitCode = 2;
  }
}
