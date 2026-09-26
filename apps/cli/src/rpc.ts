export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export function validEndpoint(value: string | undefined): boolean {
  try { return new URL(value ?? "").protocol === "https:"; } catch { return false; }
}

export async function verifyRpc(endpoint: string, request: typeof fetch = fetch) {
  if (!validEndpoint(endpoint)) throw new Error("RPC endpoint must be a complete HTTPS URL.");
  const call = async (method: string, params: unknown[] = []) => {
    let response: Response;
    try {
      response = await request(endpoint, {
        method: "POST", redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new Error("RPC network request failed or timed out; credentials withheld."); }
    if (!response.ok) throw new Error(`RPC HTTP status ${response.status}.`);
    let body: { result?: unknown; error?: unknown };
    try { body = await response.json() as typeof body; }
    catch { throw new Error("RPC returned invalid JSON; response withheld."); }
    if (!body || typeof body !== "object" || body.error) throw new Error("RPC returned an error; response withheld.");
    return body.result;
  };
  if (await call("getGenesisHash") !== MAINNET_GENESIS) throw new Error("RPC endpoint is not Solana mainnet-beta.");
  const slot = await call("getSlot", [{ commitment: "finalized" }]);
  if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0) throw new Error("RPC returned an invalid finalized slot.");
  return { cluster: "mainnet-beta" as const, finalizedSlot: String(slot) };
}
