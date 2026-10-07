/** Consume only after the caller has confirmed a successful world load. */
export function showLegacyBookNotice(doc: Document, source: { takeLegacyBookImportNotice(): boolean }): void {
  const notice = doc.querySelector<HTMLElement>('#book-import-notice');
  if (!notice) throw new Error('Missing book import notice.');
  const migrated = source.takeLegacyBookImportNotice();
  notice.hidden = !migrated;
  notice.textContent = migrated ? 'Old bookless reading ended. Five starter titles were added; copies that did not fit on a bookcase are in household inventory. Use Build, then Books, to manage them.' : '';
}
