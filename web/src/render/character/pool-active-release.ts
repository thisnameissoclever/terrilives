import motionText from '../../../../assets/models/sims/character-creator/pool_activity_motion_v23.json?raw';
import fixtureText from '../../../../assets/models/sims/character-creator/clips/pool/contacts-v12.json?raw';
import climbOut from '../../../../assets/models/sims/character-creator/clips/pool/ladder-climb-out-v6.poolroute?url';
import type {PoolContactRelease} from './pool-contact-release.js';

export const activePoolRelease = {
  // The worker hashes these exact bytes. Parse the same copy for playback so
  // each game bundle carries the fixture only once.
  motion: JSON.parse(motionText) as unknown, motionText,
  fixture: JSON.parse(fixtureText) as unknown, fixtureText,
  family: {
    url: climbOut,
    sha256: '1158d2406a53dc1a6ff482ffd59b8d9221c95f11f3c65a4bf56b53f45d768ae0',
    byteLength: 257,
  },
} satisfies PoolContactRelease;
