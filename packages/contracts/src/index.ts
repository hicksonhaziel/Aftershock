import { z } from "zod";

// Draft application contracts, not provider wire schemas.
export const unsignedInteger = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1);

export const verdictSchema = z.enum([
  "PASS", "FAIL", "INCONCLUSIVE", "UNSUPPORTED", "RUNNER_ERROR", "CANCELLED",
]);
export const checkTypeSchema = z.enum([
  "reference", "metamorphic", "application",
]);
export const transportSchema = z.enum(["mirage", "yellowstone"]);

export const captureEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  captureId: identifier,
  deliveryId: identifier,
  sourceSequence: unsignedInteger,
  receivedAtUtc: z.iso.datetime(),
  receivedOffsetNs: unsignedInteger,
  transport: transportSchema,
  kind: z.enum(["transaction", "account", "slot", "control"]),
  slot: unsignedInteger.optional(),
  transactionSignature: identifier.optional(),
  commitmentObservation: z.enum(["processed", "confirmed", "finalized"]).optional(),
  rawPayloadRef: identifier,
  rawPayloadSha256: sha256,
});

export const executionControlSchema = z.strictObject({
  controlledBoundaries: z.array(identifier),
  uncontrolledDependencies: z.array(identifier),
});

export const adapterDescriptionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adapterVersion: identifier,
  projectionContract: identifier,
  acknowledgement: z.enum(["receipt", "processed", "durable-commit"]),
  supportsCheckpoints: z.boolean(),
  supportsFaultBarriers: z.array(identifier),
  deterministicDependencies: z.array(identifier),
  executionControl: executionControlSchema,
});

export const checkResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assertionId: identifier,
  checkType: checkTypeSchema,
  verdict: verdictSchema,
  coverage: z.enum(["complete", "incomplete", "not-assessed"]),
  summary: identifier,
  evidenceRefs: z.array(identifier),
});

export type CaptureEnvelope = z.infer<typeof captureEnvelopeSchema>;
export type AdapterDescription = z.infer<typeof adapterDescriptionSchema>;
export type CheckResult = z.infer<typeof checkResultSchema>;

export * from "./capture.js";
export * from "./reference.js";
