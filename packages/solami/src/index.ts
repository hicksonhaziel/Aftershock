export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export type ReadMethod = "getGenesisHash" | "getSlot" | "getBlocks" | "getBlock";
export class RpcFailure extends Error {
  constructor(readonly kind: "configuration" | "network" | "http" | "size" | "format" | "rpc", readonly code?: number) {
    super(`RPC ${kind} failure${code === undefined ? "" : ` (${code})`}; upstream details withheld.`);
  }
}
export function validEndpoint(value: string | undefined): boolean {
  try { return new URL(value ?? "").protocol === "https:"; } catch { return false; }
}

/** Read-only JSON-RPC with a response byte cap and no credential-bearing errors. */
export async function readRpc(endpoint: string, method: ReadMethod, params: unknown[] = [], request: typeof fetch = fetch,
  maxBytes = 2 * 1024 * 1024): Promise<{ result: unknown; raw: Buffer }> {
  if (!validEndpoint(endpoint) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RpcFailure("configuration");
  try {
    const response = await request(endpoint, { method: "POST", redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new RpcFailure("http", response.status); }
    const reader = response.body?.getReader();
    if (!reader) throw new RpcFailure("format");
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maxBytes) { await reader.cancel(); throw new RpcFailure("size"); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const raw = Buffer.concat(parts);
    let body: { result?: unknown; error?: { code?: unknown } };
    try { body = JSON.parse(raw.toString()) as typeof body; } catch { throw new RpcFailure("format"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RpcFailure("format");
    if (body.error) throw new RpcFailure("rpc", typeof body.error.code === "number" && Number.isSafeInteger(body.error.code) ? body.error.code : undefined);
    if (!("result" in body)) throw new RpcFailure("format");
    return { result: body.result, raw };
  } catch (error) {
    if (error instanceof RpcFailure) throw error;
    throw new RpcFailure("network");
  }
}

export async function verifyRpc(endpoint: string, request: typeof fetch = fetch) {
  if ((await readRpc(endpoint, "getGenesisHash", [], request)).result !== MAINNET_GENESIS) throw new Error("RPC endpoint is not Solana mainnet-beta.");
  const slot = (await readRpc(endpoint, "getSlot", [{ commitment: "finalized" }], request)).result;
  if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0) throw new Error("RPC returned an invalid finalized slot.");
  return { cluster: "mainnet-beta" as const, finalizedSlot: String(slot) };
}
