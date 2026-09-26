/** Extract exactly one length-delimited field without re-encoding unknown fields. */
export function protobufMessageField(bytes: Uint8Array, field: number): Uint8Array {
  let offset = 0;
  let found: Uint8Array | undefined;
  function varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = bytes[offset++];
      if (byte === undefined || (i === 9 && byte > 1)) throw new Error("Invalid protobuf varint.");
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if ((byte & 128) === 0) return value;
    }
    throw new Error("Invalid protobuf varint.");
  }
  while (offset < bytes.length) {
    const tag = varint();
    if (tag > 0xffffffffn || tag < 8n) throw new Error("Invalid protobuf tag.");
    const number = Number(tag >> 3n), wire = Number(tag & 7n);
    if (number === field && wire !== 2) throw new Error("Unexpected field wire type.");
    if (wire === 0) varint();
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const length = varint();
      if (length > BigInt(bytes.length - offset)) throw new Error("Truncated protobuf field.");
      const end = offset + Number(length);
      if (number === field) {
        if (found !== undefined) throw new Error("Repeated singular message field is unsupported.");
        found = bytes.subarray(offset, end);
      }
      offset = end;
    } else throw new Error("Unsupported protobuf wire type.");
    if (offset > bytes.length) throw new Error("Truncated protobuf field.");
  }
  if (found === undefined) throw new Error("Missing protobuf message field.");
  return found;
}
