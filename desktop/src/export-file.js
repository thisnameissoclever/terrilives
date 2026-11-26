'use strict';

/**
 * Export save: asks where to save a save file and writes it there. The page
 * learns whether the player saved or cancelled, so it never reports an export
 * that did not happen. Takes the dialog and file system as parameters so the
 * rules can be tested without Electron.
 */

const EXPORT_NAME = /^natural-causes-save-\d{4}-\d{2}-\d{2}\.ncsave$/;

/**
 * @param {object} options
 * @param {(options: object) => Promise<{ canceled: boolean, filePath?: string }>} options.showSaveDialog
 * @param {(filePath: string, bytes: Uint8Array) => Promise<void>} options.writeFile
 * @param {() => string} options.downloadsDirectory
 * @param {(...parts: string[]) => string} options.join
 * @param {number} options.maxBytes
 */
function createExportFile({ showSaveDialog, writeFile, downloadsDirectory, join, maxBytes }) {
  let dialogOpen = false;
  /**
   * Resolves 'saved' or 'cancelled'. A second export while a dialog is open
   * resolves 'cancelled', so the page shows no note for the click that did
   * nothing; the first export reports its own result.
   */
  return async function exportFile(name, bytes) {
    if (typeof name !== 'string' || !EXPORT_NAME.test(name)) throw new Error('That is not a save file name.');
    if (!(bytes instanceof Uint8Array)) throw new Error('Save data must be bytes.');
    if (bytes.byteLength > maxBytes) throw new Error('Save data is larger than 256 MiB. Nothing was saved.');
    if (dialogOpen) return 'cancelled';
    dialogOpen = true;
    try {
      const result = await showSaveDialog({
        title: 'Export save',
        defaultPath: join(downloadsDirectory(), name),
        filters: [{ name: 'Natural Causes save', extensions: ['ncsave'] }],
      });
      if (result.canceled || !result.filePath) return 'cancelled';
      await writeFile(result.filePath, bytes);
      return 'saved';
    } finally {
      dialogOpen = false;
    }
  };
}

module.exports = { EXPORT_NAME, createExportFile };
