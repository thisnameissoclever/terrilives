import motionText from '../../../../assets/models/sims/character-creator/pool_activity_motion_v22.json?raw';
import fixtureText from '../../../../assets/models/sims/character-creator/clips/pool/contacts-v11.json?raw';
import climbOut from '../../../../assets/models/sims/character-creator/clips/pool/ladder-climb-out-v5.poolroute?url';
import type {PoolContactRelease} from './pool-contact-release.js';

export const activePoolRelease = {
  // The worker hashes these exact bytes. Parse the same copy for playback so
  // each game bundle carries the 1.9 MB fixture only once.
  motion: JSON.parse(motionText) as unknown, motionText,
  fixture: JSON.parse(fixtureText) as unknown, fixtureText,
  family: {
    url: climbOut,
    sha256: '5e038c2a8eb510781a31332314721bf3cf2373e1e651c0e1013904abaaee3e16',
    byteLength: 257,
  },
} satisfies PoolContactRelease;
