'use strict';

/**
 * The installed game's save folder: ordinary files in
 * `<userData>/saves`, written atomically.
 *
 * The page decides which files to keep (the slot, its last good copy,
 * damaged copies and recovery backups) with the same code the website runs.
 * This module only stores bytes under names that code can produce, and
 * makes each write all or nothing: the bytes go to a temporary file in the
 * same folder, reach the disk, then replace the target in one rename.
 * Every operation waits for the one before it.
 */

const fsPromises = require('node:fs/promises');
const path = require('node:path');

/** Every name the save code can produce, and nothing else. */
const SAVE_NAME = /^terri-save-1(\.previous|\.damaged(-\d+-\d+)?|\.v\d{1,5}(-(editable|published|standard))?-backup)?\.bin$/;
const TEMPORARY_NAME = /^terri-save-1[^/\\]*\.tmp-\d+-\d+$/;
const MAX_SAVE_BYTES = 256 * 1024 * 1024;
const RENAME_ATTEMPTS = 6;
const RETRIED_RENAME_CODES = Object.freeze(['EPERM', 'EBUSY', 'EACCES']);

function isSaveName(name) {
  return typeof name === 'string' && SAVE_NAME.test(name);
}

function requireSaveName(name) {
  if (!isSaveName(name)) throw new Error('That is not a save file name. Nothing was changed.');
}

function requireSaveBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Save data must be bytes. Nothing was changed.');
  if (bytes.byteLength > MAX_SAVE_BYTES) throw new Error('Save data is larger than 256 MiB. Nothing was changed.');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class SaveFiles {
  /**
   * @param {object} options
   * @param {string} options.directory The saves folder. Created on first write.
   * @param {typeof fsPromises} [options.fs] Injected for failure tests.
   * @param {number} [options.pid]
   * @param {string} [options.platform]
   * @param {(ms: number) => Promise<void>} [options.wait]
   */
  constructor({ directory, fs = fsPromises, pid = process.pid, platform = process.platform, wait: pause = wait }) {
    this.directory = directory;
    this.fs = fs;
    this.pid = pid;
    this.platform = platform;
    this.pause = pause;
    this.counter = 0;
    this.tail = Promise.resolve();
  }

  /** The file's bytes, or null when it or the folder does not exist. */
  read(name) {
    return this.enqueue(async () => {
      requireSaveName(name);
      try {
        const bytes = await this.fs.readFile(path.join(this.directory, name));
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    });
  }

  write(name, bytes) {
    return this.enqueue(async () => {
      requireSaveName(name);
      requireSaveBytes(bytes);
      await this.fs.mkdir(this.directory, { recursive: true });
      await this.replace(name, bytes);
    });
  }

  /** Removes a file. A missing file is not an error. */
  remove(name) {
    return this.enqueue(async () => {
      requireSaveName(name);
      try {
        await this.fs.unlink(path.join(this.directory, name));
      } catch (error) {
        if (!(error && error.code === 'ENOENT')) throw error;
      }
    });
  }

  /** Deletes temporary files left by a write the app did not finish. */
  removeStrayTemporaryFiles() {
    return this.enqueue(async () => {
      let names;
      try {
        names = await this.fs.readdir(this.directory);
      } catch (error) {
        if (error && error.code === 'ENOENT') return [];
        throw error;
      }
      const stray = names.filter((name) => TEMPORARY_NAME.test(name));
      for (const name of stray) {
        try {
          await this.fs.unlink(path.join(this.directory, name));
        } catch (error) {
          if (!(error && error.code === 'ENOENT')) throw error;
        }
      }
      return stray;
    });
  }

  async replace(name, bytes) {
    const target = path.join(this.directory, name);
    const temporary = path.join(this.directory, `${name}.tmp-${this.pid}-${++this.counter}`);
    try {
      const handle = await this.fs.open(temporary, 'wx');
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.rename(temporary, target);
    } catch (error) {
      try {
        await this.fs.unlink(temporary);
      } catch {
        // Report the original error.
      }
      throw error;
    }
  }

  /** Windows can briefly refuse a rename while a scanner or indexer holds the file. */
  async rename(from, to) {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.fs.rename(from, to);
        return;
      } catch (error) {
        const retry = this.platform === 'win32' && attempt < RENAME_ATTEMPTS
          && error && RETRIED_RENAME_CODES.includes(error.code);
        if (!retry) throw error;
        await this.pause(25 * attempt);
      }
    }
  }

  enqueue(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

module.exports = {
  MAX_SAVE_BYTES,
  SAVE_NAME,
  SaveFiles,
  TEMPORARY_NAME,
  isSaveName,
};
