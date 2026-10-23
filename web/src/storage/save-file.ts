/**
 * Moves the single save slot's bytes to and from a file the player keeps.
 *
 * Browser storage belongs to one web address, so a file is the only way to
 * carry a household to another address, browser or device. The file holds
 * exactly the bytes the game writes to its slot; nothing is added around them.
 */

export const SAVE_FILE_EXTENSION = '.ncsave';

/** A dated name, so several exports sort by day instead of overwriting. */
export function saveFileName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `natural-causes-save-${year}-${month}-${day}${SAVE_FILE_EXTENSION}`;
}

export interface DownloadDocument {
  createElement(tag: 'a'): HTMLAnchorElement;
  readonly body: { append(node: Node): void };
}

export interface ObjectUrls {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/**
 * Hands the bytes to the browser as a download. The object URL is released
 * after a delay because some browsers start reading it after `click` returns.
 */
export function downloadSaveFile(
  bytes: Uint8Array,
  name: string,
  doc: DownloadDocument = document,
  urls: ObjectUrls = URL,
  later: (callback: () => void) => void = (callback) => setTimeout(callback, 60_000),
): void {
  const blob = new Blob([bytes.slice()], { type: 'application/octet-stream' });
  const url = urls.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  later(() => urls.revokeObjectURL(url));
}

/** Reads a chosen file's bytes. */
export async function readSaveFile(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
