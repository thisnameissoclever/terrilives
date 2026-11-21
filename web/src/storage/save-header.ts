const MAGIC = [84, 69, 82, 82, 73, 83, 65, 86] as const;
export const CURRENT_SAVE_VERSION = 27;
// Versions 25 and 26 belong to unpublished branches.
const LAST_CONTIGUOUS_SAVE_VERSION = 24;

export function isSupportedSaveVersion(version: number): boolean {
  return version === CURRENT_SAVE_VERSION || (version >= 1 && version <= LAST_CONTIGUOUS_SAVE_VERSION);
}

/** Reads only the wire prefix, not snapshot validity or content compatibility. */
export function saveSchemaVersion(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 10 || MAGIC.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(8, true);
}

// Two builds used V24. Only the published Career build used this
// postcard-encoded content fingerprint at the start of its payload.
const CAREER_V24_FINGERPRINT = [164, 220, 210, 228, 250, 221, 197, 136, 81] as const;

export function isSupportedSavePrefix(bytes: Uint8Array): boolean {
  const version = saveSchemaVersion(bytes);
  return version !== null && isSupportedSaveVersion(version)
    && (version !== 24 || CAREER_V24_FINGERPRINT.every((byte, index) => bytes[10 + index] === byte));
}
