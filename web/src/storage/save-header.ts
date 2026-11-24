const MAGIC = [84, 69, 82, 82, 73, 83, 65, 86] as const;
export const CURRENT_SAVE_VERSION = 30;

// These match the producer dispatch in SimHandle::load_bytes.
const EDITABLE_FINGERPRINT = 0x7229_9218_57a2_e3aen;
const CAREER_V24_FINGERPRINT = 0x5111_16ef_ac94_ae24n;

export function isSupportedSaveVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1 && version <= CURRENT_SAVE_VERSION;
}

/** Reads only the wire prefix, not snapshot validity or content compatibility. */
export function saveSchemaVersion(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 10 || MAGIC.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(8, true);
}

// Postcard encodes u64 values in groups of seven bits, least significant first.
function contentFingerprint(bytes: Uint8Array): bigint | null {
  let value = 0n;
  for (let i = 0; i < 10 && 10 + i < bytes.length; i++) {
    const byte = bytes[10 + i];
    if (i === 9 && byte > 1) return null;
    value |= BigInt(byte & 0x7f) << BigInt(i * 7);
    if (byte < 0x80) return value;
  }
  return null;
}

export function saveWireFamily(bytes: Uint8Array): 'editable' | 'published' | 'standard' | null {
  const version = saveSchemaVersion(bytes);
  if (version === null || !isSupportedSaveVersion(version)) return null;
  if (version < 22 || version > 24) return 'standard';
  const fingerprint = contentFingerprint(bytes);
  if (fingerprint === null) return null;
  if (fingerprint === EDITABLE_FINGERPRINT) return 'editable';
  if (version === 24 && fingerprint !== CAREER_V24_FINGERPRINT) return null;
  return 'published';
}

export function isSupportedSavePrefix(bytes: Uint8Array): boolean {
  return saveWireFamily(bytes) !== null;
}

/** Checks that a retained backup belongs to the source save's wire format. */
export function isMatchingSavePrefix(backup: Uint8Array, source: Uint8Array): boolean {
  const family = saveWireFamily(backup);
  return family !== null && saveSchemaVersion(backup) === saveSchemaVersion(source)
    && family === saveWireFamily(source);
}
