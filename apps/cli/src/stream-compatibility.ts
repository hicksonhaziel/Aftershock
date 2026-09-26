import { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import { isDeepStrictEqual } from "node:util";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing transaction evidence.");
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Missing transaction array.");
  return value;
};
const configKeys = ["priorityFee", "computeUnitLimit", "loadedAccountsDataSizeLimit", "heapSize"] as const;
function config(value: unknown) {
  const input = object(value);
  if (Object.keys(input).some(key => !configKeys.includes(key as typeof configKeys[number]))) throw new Error("Unknown transaction config field.");
  return Object.fromEntries(configKeys.flatMap(key => {
    const n = input[key];
    if (n === undefined || n === null) return [];
    if (typeof n === "number" && (!Number.isSafeInteger(n) || n < 0)) throw new Error("Unsafe reference integer.");
    if ((typeof n !== "string" && typeof n !== "number") || !/^(0|[1-9][0-9]*)$/.test(String(n))) throw new Error("Invalid config integer.");
    return [[key, String(n)]];
  }));
}

/** Narrow semantic audit, not a business-event decoder or complete schema certification. */
export function compareStreamTransaction(raw: Uint8Array, reference: unknown) {
  const update = SubscribeUpdate.decode(raw);
  const info = update.transaction?.transaction, tx = info?.transaction, message = tx?.message, meta = info?.meta;
  if (!info || !tx || !message || !meta || !message.header || info.signature.length !== 64) throw new Error("Incomplete stream transaction.");
  const entry = object(reference), rpcTx = object(entry.transaction), rpcMessage = object(rpcTx.message), rpcMeta = object(entry.meta);
  if (entry.version !== "legacy" && entry.version !== 0 && entry.version !== 1) throw new Error("Unsupported reference version.");
  if (!("err" in rpcMeta)) throw new Error("Missing execution status.");
  const loaded = entry.version === 0 ? object(rpcMeta.loadedAddresses) : { writable: [], readonly: [] };
  const version = message.config !== undefined ? 1 : message.versioned ? 0 : "legacy";
  const stream = {
    version, signatures: tx.signatures.map(key => bs58.encode(key)), header: message.header,
    accountKeys: message.accountKeys.map(key => bs58.encode(key)),
    loadedWritable: meta.loadedWritableAddresses.map(key => bs58.encode(key)),
    loadedReadonly: meta.loadedReadonlyAddresses.map(key => bs58.encode(key)),
    recentBlockhash: bs58.encode(message.recentBlockhash),
    instructions: message.instructions.map(ix => ({ programIdIndex: ix.programIdIndex, accounts: [...ix.accounts], data: bs58.encode(ix.data) })),
    addressTableLookups: message.addressTableLookups.map(lookup => ({ accountKey: bs58.encode(lookup.accountKey), writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes] })),
    config: message.config === undefined ? null : config(message.config), successful: meta.err === undefined,
  };
  const rpc = {
    version: entry.version, signatures: array(rpcTx.signatures), header: object(rpcMessage.header),
    accountKeys: array(rpcMessage.accountKeys), loadedWritable: array(loaded.writable), loadedReadonly: array(loaded.readonly),
    recentBlockhash: rpcMessage.recentBlockhash,
    instructions: array(rpcMessage.instructions).map(item => {
      const ix = object(item);
      return { programIdIndex: ix.programIdIndex, accounts: array(ix.accounts), data: ix.data };
    }),
    addressTableLookups: entry.version === 0 ? array(rpcMessage.addressTableLookups) : [],
    config: entry.version === 1 ? config(rpcMessage.transactionConfig) : null, successful: rpcMeta.err === null,
  };
  const mismatches = (Object.keys(stream) as (keyof typeof stream)[]).filter(key => !isDeepStrictEqual(stream[key], rpc[key]));
  if (stream.signatures[0] !== bs58.encode(info.signature)) mismatches.push("signatures");
  return { slot: update.transaction!.slot, signature: bs58.encode(info.signature), streamVersion: version, referenceVersion: entry.version,
    verdict: mismatches.length ? "FAIL" as const : "PASS" as const, mismatches: [...new Set(mismatches)] };
}
