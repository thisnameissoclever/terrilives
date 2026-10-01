const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const CANDIDATES = [
  ['sfx100v2_loop_water_01.ogg', 'rubberduck-100-sfx-2', '100-cc0-sfx-2', '955a367cf87f150f7868e2ecf5745ef13cec2c78a29304eda27e74f1fea06c57'],
  ['sfx100v2_loop_water_02.ogg', 'rubberduck-100-sfx-2', '100-cc0-sfx-2', '32bc3462ebd2376d9b84e8f602969f8c2a475f589adee9804207e19116cda768'],
  ['sfx100v2_loop_water_03.ogg', 'rubberduck-100-sfx-2', '100-cc0-sfx-2', '33b123860425a34ce8de43cfa075b0b4ffb7a3cf090be5c21213c9b99f3d2fa3'],
  ['water_boiling.ogg', 'rubberduck-30-sfx-loops', '30-cc0-sfx-loops', 'e75fb982ec50cca628ba18845e81211e12ed4cdc5080609d55ee2d60873320af'],
  ['water_flowing.ogg', 'rubberduck-30-sfx-loops', '30-cc0-sfx-loops', '1a431f77d61661becdc87a5b1832d47f83a12a5c0b001077e41a202e739797a7'],
].map(([file, pack, slug, sha256]) => ({
  file, pack, sha256, author: 'rubberduck', license: 'CC0-1.0',
  page: `https://opengameart.org/content/${slug}`,
}));

function buildReview({ intake, output, candidates = CANDIDATES }) {
  const repository = fs.realpathSync(path.resolve(__dirname, '..'));
  const destination = path.join(fs.realpathSync(path.dirname(path.resolve(output))), path.basename(output));
  const relative = path.relative(repository, destination);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    throw new Error('Review output must be outside the repository');
  }
  const sourceRoot = fs.realpathSync(intake);
  const records = candidates.map(candidate => {
    if (path.basename(candidate.file) !== candidate.file || /[\\/:]/.test(candidate.file)) {
      throw new Error('Each candidate must be a direct child of the intake directory');
    }
    const source = fs.realpathSync(path.join(sourceRoot, candidate.file));
    if (path.dirname(source) !== sourceRoot) throw new Error('Candidate must resolve to a direct child of intake');
    if (!fs.statSync(source).isFile() || fs.statSync(source).size > 5 * 1024 * 1024) {
      throw new Error('Candidate must be a file no larger than 5 MiB');
    }
    const bytes = fs.readFileSync(source);
    if (createHash('sha256').update(bytes).digest('hex') !== candidate.sha256) {
      throw new Error(`SHA-256 mismatch: ${candidate.file}`);
    }
    return { ...candidate, data: `data:audio/ogg;base64,${bytes.toString('base64')}` };
  });
  const template = fs.readFileSync(path.join(__dirname, 'audio-audition.html'), 'utf8');
  const json = JSON.stringify(records).replaceAll('<', '\\u003c');
  fs.writeFileSync(destination, template.replace('__CANDIDATES__', () => json), { flag: 'wx' });
  return destination;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('Usage: node scripts/build-audio-audition.cjs <audition-directory> <new-review.html>');
    process.exitCode = 1;
  } else {
    try { console.log(buildReview({ intake: args[0], output: args[1] })); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { buildReview };
