import type { SimBridge } from '../bridge.js';
import { householdMembers } from '../ui/household-roster.js';
import type { HousemateSource } from './admin-housemate.js';
import type { HouseholdSource } from './admin-household.js';
import type { RelationshipsSource } from './admin-relationships.js';

// Adapters from the bridge to the admin tabs' sources (issue 312, [AP-web-files]
// in docs/specs/2026-11-20-admin-panel.md). The tabs name people by SimId, which
// is stable across the world restore Undo performs; the bridge's older reads
// are keyed by entity index, which is not. Each adapter looks the entity up at
// the moment of the read, from the live household, so no index is held between
// calls.

/** A housemate's entity index right now, or null when the SimId is no longer a member. */
export function entityOfSim(sim: SimBridge, simId: number): number | null {
  return householdMembers(sim).find(member => member.simId === simId)?.entity ?? null;
}

/** Runs `read` on the housemate's entity right now, or answers `empty` for a SimId that is no longer a member. */
function readEntity<T>(sim: SimBridge, simId: number, empty: T, read: (entity: number) => T): T {
  const entity = entityOfSim(sim, simId);
  return entity === null ? empty : read(entity);
}

/** The Household tab's reads over the live bridge. */
export function householdSource(sim: SimBridge): HouseholdSource {
  return {
    fundsCents: () => sim.fundsCents(),
    bills: () => sim.adminBills(),
    terms: () => {
      const overview = sim.billsOverview();
      return overview === null ? null : {
        graceDays: overview.graceDays, lateFeePercent: overview.lateFeePercent,
        lateFeeCapPercent: overview.lateFeeCapPercent, nextDueDay: overview.nextDueDay,
      };
    },
    // What each kind's bill has come to this month so far, which is the amount a new bill starts with.
    monthAmounts: () => {
      const next = sim.billsNext();
      return [0, 1, 2, 3].map(kind => next.find(bill => bill.kind === kind)?.soFarCents ?? 0);
    },
    clockTick: () => sim.clockTick(),
    dayTicks: () => sim.dayTicks(),
    weekdayIndex: () => sim.weekdayIndex(),
  };
}

/** The Relationships tab's reads over the live bridge. */
export function relationshipsSource(sim: SimBridge): RelationshipsSource {
  return {
    relationships: id => readEntity(sim, id, new Float32Array(0), entity => sim.relationshipsOf(entity)),
    adminTimers: id => sim.adminTimers(id),
    clockTick: () => sim.clockTick(),
    dayTicks: () => sim.dayTicks(),
  };
}

/** The Housemate tab's reads over the live bridge. */
export function housemateSource(sim: SimBridge): HousemateSource {
  const withEntity = <T>(simId: number, empty: T, read: (entity: number) => T): T => readEntity(sim, simId, empty, read);
  return {
    library: () => {
      const pathLabels = sim.careerPathLabels();
      return {
        // The simulation names a need in lower case; the panel words it as a name, as the buy tool does.
        needNames: sim.needNames().map(name => name.charAt(0).toUpperCase() + name.slice(1)),
        needMax: sim.needMax(),
        skillLabels: sim.skillLabels(),
        skillLevels: sim.skillLevels(),
        traitLabels: sim.traitLabels(),
        traitKinds: sim.traitKinds(),
        traitSkills: sim.adminTraitSkills(),
        affinityLabels: sim.affinityLabels(),
        pathLabels,
        levelTitles: pathLabels.map((_, path) => sim.careerLevelTitles(path)),
        jobOptions: sim.adminJobOptions(),
        limits: sim.adminLimits(),
      };
    },
    adminPerson: id => sim.adminPerson(id),
    adminRepetition: id => sim.adminRepetition(id),
    adminMoodlets: id => sim.adminMoodlets(id),
    adminTimers: id => sim.adminTimers(id),
    adminAffinities: id => sim.adminAffinities(id),
    // The scores, then the labels, as the Mood panel reads them: both copies, no tick between.
    moodScores: id => withEntity(id, [], entity => Array.from(sim.moodSnapshotOf(entity))),
    moodLabels: id => withEntity(id, [], entity => sim.moodSummaryOf(entity)),
    repeatedLabels: id => withEntity(id, [], entity => sim.simDetailsOf(entity)?.repeated ?? []),
    affinityWords: id => withEntity(id, null, entity => sim.affinityWordsOf(entity)),
    skills: id => withEntity(id, null, entity => sim.skillsOf(entity)),
    traits: id => withEntity(id, new Float32Array(0), entity => sim.traitsOf(entity)),
    careerShifts: id => withEntity(id, [], entity => sim.careerShiftsOf(entity)),
    skillPracticeFor: (skill, level, fraction) => sim.skillPracticeFor(skill, level, fraction),
    clockTick: () => sim.clockTick(),
    dayTicks: () => sim.dayTicks(),
    deathEnabled: () => sim.deathEnabled(),
  };
}
