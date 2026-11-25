/**
 * The one save slot's file rules, shared by the website and the installed game.
 *
 * The website keeps these files in the Origin Private File System through the
 * storage worker; the installed game keeps them as ordinary files through the
 * desktop bridge. Both pass a `SlotDirectory`, so the slot, its last good
 * copy, damaged copies and historical recovery backups follow exactly the
 * same rules in both places.
 *
 * Before the slot is touched, its good bytes are copied to a last good copy,
 * and a failed write puts them back. If the writer is stopped outright, the
 * next load finds the damage and the controller recovers through `previous`
 * and `restore`.
 */

import { CURRENT_SAVE_VERSION, isMatchingSavePrefix, isSupportedSavePrefix, saveSchemaVersion, saveWireFamily } from './save-header.js';

export const SAVE_FILE = 'terri-save-1.bin';
export const PREVIOUS_FILE = 'terri-save-1.previous.bin';
export const DAMAGED_FILE = 'terri-save-1.damaged.bin';

/** The folder that holds the slot's files. */
export interface SlotDirectory {
  /** The file's bytes, or null when it does not exist. */
  read(name: string): Promise<ArrayBuffer | null>;
  /** Creates or replaces the file. */
  write(name: string, bytes: ArrayBuffer): Promise<void>;
  /** Removes the file. A missing file is not an error. */
  remove(name: string): Promise<void>;
}

/**
 * One slot's state across requests. The directory is passed with each call,
 * because the website's worker opens it afresh inside its lock every time.
 */
export class SaveSlot {
  /** Set when a failed write could not be undone, so the slot may be half written. */
  private slotSuspect = false;

  load(root: SlotDirectory): Promise<ArrayBuffer | null> {
    return read(root);
  }

  save(root: SlotDirectory, next: ArrayBuffer): Promise<void> {
    return this.saveCurrent(root, next);
  }

  /** The last good copy, or null when there is no usable one. Changes nothing. */
  previous(root: SlotDirectory): Promise<ArrayBuffer | null> {
    return readLastGood(root);
  }

  restore(root: SlotDirectory, loaded: ArrayBuffer, expected: ArrayBuffer): Promise<boolean> {
    return this.restoreLastGood(root, loaded, expected);
  }

  async clear(root: SlotDirectory): Promise<void> {
    // New game clears the playable slot and its last good copy, never the
    // historical recovery backups. The copy goes first so a crash between
    // the two removals cannot leave an old game that recovery would revive.
    await removeIfPresent(root, PREVIOUS_FILE);
    await removeIfPresent(root);
  }

  /**
   * Writes the current save without ever leaving the slot worse than it was.
   *
   * A page can close in the middle of a write, and not every browser stages the
   * stream's bytes until close. So before the slot is touched, its good bytes are
   * copied to a last good copy, and a failed write puts them back. If the worker
   * is killed outright, the next load finds the damage and the controller
   * recovers through `readLastGood` and `restoreLastGood`. A slot that holds
   * nothing is not a save: it is replaced without complaint, which is what a first save cut off at creation leaves.
   */
  private async saveCurrent(root: SlotDirectory, next: ArrayBuffer): Promise<void> {
    const slot = await preserveHistoricalBackup(root, next);
    // A slot this worker failed to put back may be half written yet still carry a
    // supported header, so it must not replace the last good copy.
    if (slot !== null && !this.slotSuspect) await keepLastGoodCopy(root, slot);
    try {
      await write(root, SAVE_FILE, next);
      this.slotSuspect = false;
    } catch (error: unknown) {
      if (slot !== null) {
        try {
          await write(root, SAVE_FILE, slot);
        } catch {
          // The last good copy still holds these bytes. Report the original error.
          this.slotSuspect = true;
        }
      } else {
        this.slotSuspect = true;
      }
      throw error;
    }
  }

  /**
   * Replaces an unreadable slot with the last good copy once the caller has
   * loaded that copy successfully. The unreadable bytes are kept in a damaged copy
   * first, never over an earlier one. Changes nothing, and returns false, when
   * the last good copy or the slot is no longer what the caller saw: another tab
   * may have saved in between.
   */
  private async restoreLastGood(
    root: SlotDirectory,
    loaded: ArrayBuffer,
    expected: ArrayBuffer,
  ): Promise<boolean> {
    const previous = await readLastGood(root);
    if (previous === null || !sameBytes(previous, loaded)) return false;
    const current = await read(root);
    if (!sameBytes(current ?? new ArrayBuffer(0), expected)) return false;
    if (current !== null && current.byteLength > 0) {
      const currentBytes = new Uint8Array(current);
      if (saveSchemaVersion(currentBytes) !== null && !isSupportedSavePrefix(currentBytes)) return false;
      await write(root, await unusedDamagedName(root), current);
    }
    await write(root, SAVE_FILE, previous);
    this.slotSuspect = false;
    return true;
  }
}

function read(root: SlotDirectory, name = SAVE_FILE): Promise<ArrayBuffer | null> {
  return root.read(name);
}

function write(root: SlotDirectory, name: string, bytes: ArrayBuffer): Promise<void> {
  return root.write(name, bytes);
}

function removeIfPresent(root: SlotDirectory, name = SAVE_FILE): Promise<void> {
  return root.remove(name);
}

async function keepLastGoodCopy(root: SlotDirectory, slot: ArrayBuffer): Promise<void> {
  try {
    await write(root, PREVIOUS_FILE, slot);
  } catch (error: unknown) {
    // An incomplete copy must not be trusted by a later recovery.
    try {
      await removeIfPresent(root, PREVIOUS_FILE);
    } catch {
      // Report the original error.
    }
    throw error;
  }
}

/** The last good copy, or null when there is no usable one. Changes nothing. */
async function readLastGood(root: SlotDirectory): Promise<ArrayBuffer | null> {
  const previous = await read(root, PREVIOUS_FILE);
  if (previous === null || previous.byteLength === 0 || !isSupportedSavePrefix(new Uint8Array(previous))) {
    return null;
  }
  return previous;
}

async function unusedDamagedName(root: SlotDirectory): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = attempt === 0 ? DAMAGED_FILE : `terri-save-1.damaged-${Date.now()}-${attempt}.bin`;
    if (await read(root, name) === null) return name;
  }
  throw new Error('Too many damaged save copies are kept. The saved game was not replaced.');
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.every((value, index) => value === right[index]);
}

/**
 * Guard every current write and preserve original historical wire bytes: the first
 * current write over an older slot keeps that slot's bytes in a recovery
 * backup. The game never loads a backup by itself; it is kept for deliberate
 * recovery ([RC-save] in docs/specs/2026-09-22-colourways.md). Returns the
 * slot's bytes, or null when the slot is missing or empty.
 */
async function preserveHistoricalBackup(
  root: SlotDirectory,
  next: ArrayBuffer,
): Promise<ArrayBuffer | null> {
  if (saveSchemaVersion(new Uint8Array(next)) !== CURRENT_SAVE_VERSION) {
    throw new Error(`Only current V${CURRENT_SAVE_VERSION} saves can be written. Saved data has not been changed.`);
  }
  const previous = await read(root);
  if (previous === null || previous.byteLength === 0) return null;
  const source = new Uint8Array(previous);
  const previousVersion = saveSchemaVersion(source);
  const sourceFamily = saveWireFamily(source);
  if (previousVersion === null || sourceFamily === null) {
    throw new Error('The saved file has an unreadable or unsupported version. It was not replaced.');
  }
  if (previousVersion === CURRENT_SAVE_VERSION) return previous;
  let backupFile = `terri-save-1.v${previousVersion}-backup.bin`;
  let existing = await read(root, backupFile);
  if (existing !== null) {
    const backup = new Uint8Array(existing);
    if (isMatchingSavePrefix(backup, source)) return previous;
    // Older workers shared this name across both V22 and V23 producers.
    // Keep the first backup for each family, regardless of migration order.
    if ((previousVersion === 22 || previousVersion === 23)
        && saveSchemaVersion(backup) === previousVersion && saveWireFamily(backup) !== null) {
      backupFile = `terri-save-1.v${previousVersion}-${sourceFamily}-backup.bin`;
      existing = await read(root, backupFile);
      if (existing !== null && isMatchingSavePrefix(new Uint8Array(existing), source)) return previous;
    }
    if (existing !== null) {
      throw new Error(`The existing V${previousVersion} recovery backup is unreadable. The saved game was not replaced.`);
    }
  }
  try {
    await write(root, backupFile, previous);
  } catch (error: unknown) {
    // Remove only the incomplete backup created by this operation, while
    // still holding the origin lock. A retry must not trust an empty file.
    await removeIfPresent(root, backupFile);
    throw error;
  }
  return previous;
}
