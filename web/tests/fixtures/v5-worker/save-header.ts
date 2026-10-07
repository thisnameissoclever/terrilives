const MAGIC = [84, 69, 82, 82, 73, 83, 65, 86] as const;

/** Reads only the wire prefix, not snapshot validity or content compatibility. */
export function saveSchemaVersion(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 10 || MAGIC.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(8, true);
}
