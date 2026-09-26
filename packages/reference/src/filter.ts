const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const voteProgram = "Vote111111111111111111111111111111111111111";
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing reference object.");
  return value as Record<string, unknown>;
};
const strings = (value: unknown, pattern: RegExp): string[] => {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !pattern.test(item))) throw new Error("Invalid reference array.");
  return value as string[];
};

/** Full JSON getBlock response, with maxSupportedTransactionVersion: 1.
 * Simple vote semantics: anza-xyz/solana-sdk transaction/src/simple_vote_transaction_checker.rs.
 * Unknown/missing evidence throws; callers must report incomplete coverage, never an empty block.
 */
export function filterFinalizedBlock(value: unknown, accountInclude: string[]) {
  if (!accountInclude.length || accountInclude.some(key => !address.test(key))) throw new Error("Invalid account filter.");
  const block = object(value);
  if (typeof block.blockhash !== "string" || !address.test(block.blockhash) || !Array.isArray(block.transactions)) throw new Error("Invalid reference block.");
  const signatures: string[] = [];
  const seen = new Set<string>();
  for (const item of block.transactions) {
    const entry = object(item), transaction = object(entry.transaction), message = object(transaction.message), meta = object(entry.meta);
    if (entry.version !== "legacy" && entry.version !== 0 && entry.version !== 1) throw new Error("Unsupported or missing transaction version.");
    const ids = strings(transaction.signatures, signature);
    if (!ids.length || seen.has(ids[0]!)) throw new Error("Missing or duplicate transaction identity.");
    seen.add(ids[0]!);
    const keys = [...strings(message.accountKeys, address)];
    if (!keys.length || !Array.isArray(message.instructions) || !("err" in meta)) throw new Error("Incomplete transaction evidence.");
    if (entry.version === 0) {
      const loaded = object(meta.loadedAddresses);
      keys.push(...strings(loaded.writable, address), ...strings(loaded.readonly, address));
    }
    const programs = message.instructions.map(instruction => {
      const index = object(instruction).programIdIndex;
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= keys.length) throw new Error("Invalid instruction program index.");
      return keys[index];
    });
    const isVote = entry.version === "legacy" && ids.length < 3 && programs.length === 1 && programs[0] === voteProgram;
    if (meta.err === null && !isVote && keys.some(key => accountInclude.includes(key))) signatures.push(ids[0]!);
  }
  return { blockhash: block.blockhash, signatures, transactionCount: block.transactions.length };
}
