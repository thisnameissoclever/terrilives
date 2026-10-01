const fs = require('node:fs');
const path = require('node:path');
const { renderReview } = require('./build-audio-audition.cjs');

const CANDIDATES = [
  ['paper_01.ogg', 25529, 'b2b2b55e44761c7a45283bce0196f41f72207180fb08c970d7dcf93b705d280c'],
  ['paper_02.ogg', 27205, '4d0c68b367bd3fbdf9817e764908e5524b2cad6536eb0911fc74f6ab4f60c50a'],
  ['paper_03.ogg', 29838, '90147dde68b9e2082404f439165bbcb6f7c2364e88e9373d1cd1f7446a37f7b2'],
  ['paper_04.ogg', 32322, 'afae7236bce275fad555922cc8578882eb0c0b5d822be0a9180c9efdadf4a770'],
].map(([file, bytes, sha256]) => ({ file, bytes, sha256, author: 'rubberduck',
  license: 'CC0-1.0', pack: 'rubberduck-100-sfx', page: 'https://opengameart.org/content/100-cc0-sfx' }));

function publishPaperReview() {
  if (arguments.length !== 0) throw new Error('Paper review publication does not accept path or candidate overrides');
  const repository = fs.realpathSync(path.resolve(__dirname, '..'));
  const intake = path.join(repository, 'assets/audio/review/paper');
  const destination = path.join(repository, 'web/public/audio-review.html');
  for (const directory of [intake, path.dirname(destination)]) {
    if (fs.realpathSync(directory) !== directory || !fs.statSync(directory).isDirectory()) {
      throw new Error('Paper review must use its fixed source and destination directory');
    }
  }
  const html = renderReview({ intake, candidates: CANDIDATES, metadata: {
    title: 'Paper sound review',
    introduction: 'Four unedited, unreviewed recordings, not approved game sounds. This page changes no game audio. Nothing plays until you press Play.',
    instructions: 'Does each rustle fit a page turn, or does it sound like a tear, crumple, or unwanted noise? Compare Play original and Repeat for 15 seconds. Keep for editing is not shipping approval. Notes are not saved automatically. Closing or reloading loses notes unless you download them.',
  } });
  if (fs.existsSync(destination)) {
    if (!fs.lstatSync(destination).isFile() || fs.realpathSync(destination) !== destination) {
      throw new Error('Existing paper review must be a regular file at its fixed destination');
    }
    if (!fs.readFileSync(destination).equals(Buffer.from(html))) {
      throw new Error('Existing paper review differs; refusing to replace it');
    }
    return destination;
  }
  fs.writeFileSync(destination, html, { flag: 'wx' });
  return destination;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/publish-paper-audio-review.cjs');
    console.log(publishPaperReview());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { publishPaperReview };
