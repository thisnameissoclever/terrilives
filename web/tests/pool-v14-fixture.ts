import text from '../../assets/models/sims/character-creator/clips/pool/contacts-v3.json?raw';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';

/** The v14 climb and its reverse exit share this fixture's original support schedule. */
export const poolV14Fixture = parseOwnedPoolFixture(text);
