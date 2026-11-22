const MAGIC = [84, 69, 82, 82, 73, 83, 65, 86] as const;
export const CURRENT_SAVE_VERSION = 28;

// Both V24 writers start their payload with a postcard-encoded content fingerprint.
const CAREER_V24_FINGERPRINT = [164, 220, 210, 228, 250, 221, 197, 136, 81] as const;
const EDITABLE_V24_FINGERPRINT = [174, 199, 139, 189, 133, 195, 228, 148, 114] as const;

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

export function isSupportedSavePrefix(bytes: Uint8Array): boolean {
  const version = saveSchemaVersion(bytes);
  return version !== null && isSupportedSaveVersion(version)
    && (version !== 24 || saveV24Family(bytes) !== null);
}

function saveV24Family(bytes: Uint8Array): 'career' | 'editable' | null {
  if (CAREER_V24_FINGERPRINT.every((byte, index) => bytes[10 + index] === byte)) return 'career';
  if (EDITABLE_V24_FINGERPRINT.every((byte, index) => bytes[10 + index] === byte)) return 'editable';
  return null;
}

/** Checks that a retained backup belongs to the source save's wire format. */
export function isMatchingSavePrefix(backup: Uint8Array, source: Uint8Array): boolean {
  const version = saveSchemaVersion(source);
  return isSupportedSavePrefix(backup) && saveSchemaVersion(backup) === version
    && (version !== 24 || saveV24Family(backup) === saveV24Family(source));
}
