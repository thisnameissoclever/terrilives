import motionText from '../../../../assets/models/sims/character-creator/pool_activity_motion_v18.json?raw';
import fixtureText from '../../../../assets/models/sims/character-creator/clips/pool/contacts-v7.json?raw';
import climbOut from '../../../../assets/models/sims/character-creator/clips/pool/ladder-climb-out-v1.poolroute?url';
import type {PoolContactRelease} from './pool-contact-release.js';

export const activePoolRelease = {
  // The worker hashes these exact bytes. Parse the same copy for playback so
  // each game bundle carries the 1.9 MB fixture only once.
  motion: JSON.parse(motionText) as unknown, motionText,
  fixture: JSON.parse(fixtureText) as unknown, fixtureText,
  family: {
    url: climbOut,
    sha256: 'faaecebc393a23659379777da45a17f157310a07116e00e262a25fcab6b64bd9',
    byteLength: 115979,
  },
} satisfies PoolContactRelease;
