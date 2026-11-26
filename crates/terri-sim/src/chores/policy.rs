use bevy_ecs::prelude::*;
use terri_core::{
    chores::{ChoreAssignment, ChoreKey, ChoreKind, ChoreProfile},
    Agent, AtWork, Career, Commuting, Eating, Footprint, NeedId, Needs, Position, SimRng, TileGrid,
};

const EMPLOYED_WORK_UNITS: u64 = 3;
const UNEMPLOYED_WORK_UNITS: u64 = 2;
const UNEMPLOYED_CHORE_ODDS: f32 = 1.5;
const HOME_ALONE_CHORE_ODDS: f32 = 3.0;

pub fn willingness(
    profile: &ChoreProfile,
    kind: ChoreKind,
    cleanliness: f32,
    readiness: f32,
    mood: f32,
) -> f32 {
    let responsibility = f32::from(profile.responsibility) / 100.0;
    let history = f32::from(profile.commitment) / 100.0;
    let preference = f32::from(profile.preferences[kind.index()]) / 100.0;
    (0.04
        + 0.45 * responsibility
        + 0.18 * history
        + 0.18 * cleanliness.clamp(0.0, 1.0)
        + 0.14 * preference
        + 0.05 * mood.clamp(-1.0, 1.0))
    .clamp(0.01, 0.98)
        * readiness.clamp(0.0, 1.0)
}

pub fn enjoyment(profile: &ChoreProfile, kind: ChoreKind) -> f32 {
    f32::from(profile.preferences[kind.index()]) / 100.0
}

pub(crate) fn autonomous_chance(world: &World, person: Entity, baseline: f32) -> f32 {
    if baseline == 0.0 || baseline >= 1.0 || world.get::<Career>(person).is_some() {
        return baseline;
    }
    let pack = world.resource::<crate::Content>().0;
    if world.get::<Needs>(person).is_none_or(|needs| {
        NeedId::ALL
            .into_iter()
            .any(|need| needs.get(need) <= pack.tuning.mood_critical_need_level)
    }) {
        return baseline;
    }
    let tile = |p: &Position| (p.x.round() as i32, p.y.round() as i32);
    let Some(from) = world.get::<Position>(person).map(tile) else {
        return baseline;
    };
    let mut distances = None;
    let has_company = world
        .try_query_filtered::<Entity, With<Agent>>()
        .is_some_and(|mut people| {
            people.iter(world).any(|other| {
                other != person
                    && world.get::<Needs>(other).is_some()
                    && world.get::<AtWork>(other).is_none()
                    && world.get::<Commuting>(other).is_none()
                    && !crate::systems::circadian::is_asleep(pack, world.get::<Eating>(other))
                    && world.get::<Position>(other).map(tile).is_some_and(|to| {
                        distances
                            .get_or_insert_with(|| {
                                world.resource::<TileGrid>().distance_field(from)
                            })
                            .as_ref()
                            .is_some_and(|field| {
                                field.distance_to_adjacent(to, Footprint::SINGLE).is_some()
                            })
                    })
            })
        });
    let multiplier = if has_company {
        UNEMPLOYED_CHORE_ODDS
    } else {
        HOME_ALONE_CHORE_ODDS
    };
    // Multiplying the odds preserves the influence of even high baseline chances.
    let weighted = baseline * multiplier;
    weighted / (1.0 - baseline + weighted)
}

pub(super) struct Assignee<'a> {
    pub profile: &'a ChoreProfile,
    pub unemployed: bool,
}

impl Assignee<'_> {
    fn work_units(&self) -> u64 {
        if self.unemployed {
            UNEMPLOYED_WORK_UNITS
        } else {
            EMPLOYED_WORK_UNITS
        }
    }
}

pub(super) fn assign(
    keys: &[(ChoreKey, u32)],
    candidates: &[Assignee<'_>],
    week: u64,
    rng: &mut SimRng,
    existing: &[ChoreAssignment],
) -> Vec<ChoreAssignment> {
    if candidates.is_empty() {
        return vec![];
    }
    // Compare assigned work against each person's capacity in integer units.
    let work_units: Vec<_> = candidates.iter().map(Assignee::work_units).collect();
    let mut work = vec![0u64; candidates.len()];
    let mut assignments: Vec<_> = existing
        .iter()
        .filter(|a| {
            keys.iter().any(|(k, _)| *k == a.key)
                && candidates.iter().any(|c| c.profile.sim_id == a.owner)
        })
        .cloned()
        .collect();
    for assignment in &assignments {
        let index = candidates
            .iter()
            .position(|c| c.profile.sim_id == assignment.owner)
            .unwrap();
        let cost = keys.iter().find(|(k, _)| *k == assignment.key).unwrap().1;
        work[index] += u64::from(cost) * work_units[index];
    }
    let mut ordered: Vec<_> = keys
        .iter()
        .copied()
        .filter(|(key, _)| !assignments.iter().any(|a| a.key == *key))
        .collect();
    ordered.sort_by_key(|(key, cost)| (std::cmp::Reverse(*cost), *key));
    for (key, cost) in ordered {
        let min = *work.iter().min().unwrap();
        let choices: Vec<_> = candidates
            .iter()
            .enumerate()
            .filter(|(i, _)| work[*i] <= min + u64::from(cost / 2) * work_units[*i])
            .map(|(i, candidate)| {
                let preference = f32::from(candidate.profile.preferences[key.kind.index()]);
                let capacity = EMPLOYED_WORK_UNITS as f32 / work_units[i] as f32;
                (i, (1.2 + preference / 100.0) * capacity)
            })
            .collect();
        let total: f32 = choices.iter().map(|c| c.1).sum();
        let mut draw = rng.next_f32() * total;
        let mut selected = choices.last().unwrap().0;
        for (i, weight) in choices {
            if draw < weight {
                selected = i;
                break;
            }
            draw -= weight;
        }
        work[selected] += u64::from(cost) * work_units[selected];
        assignments.push(ChoreAssignment {
            key,
            owner: candidates[selected].profile.sim_id,
            week,
        });
    }
    assignments.sort_by_key(|a| a.key);
    assignments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unreachable_housemate_does_not_reduce_the_home_alone_boost() {
        let mut sim = crate::Sim::new_with_lot(5, 5);
        let world = sim.world_mut();
        let person = world
            .spawn((Agent, Needs::all_at(100.0), Position { x: 0.0, y: 2.0 }))
            .id();
        world.spawn((Agent, Needs::all_at(100.0), Position { x: 4.0, y: 2.0 }));
        assert_eq!(autonomous_chance(world, person, 0.4), 0.5);

        let mut grid = world.resource_mut::<TileGrid>();
        for y in 0..5 {
            grid.set_edge_blocked((1, y), (2, y), true);
        }
        assert!((autonomous_chance(world, person, 0.4) - 2.0 / 3.0).abs() < 0.000_001);
    }

    #[test]
    fn responsibility_history_and_preference_independently_change_daily_willingness() {
        let neutral = ChoreProfile::neutral(0);
        let base = willingness(&neutral, ChoreKind::Floors, 0.5, 1.0, 0.0);
        for changed in [
            ChoreProfile {
                responsibility: 90,
                ..neutral.clone()
            },
            ChoreProfile {
                commitment: 90,
                ..neutral.clone()
            },
            ChoreProfile {
                preferences: [0, 80, 0, 0],
                ..neutral.clone()
            },
        ] {
            assert!(willingness(&changed, ChoreKind::Floors, 0.5, 1.0, 0.0) > base);
        }
        assert_eq!(willingness(&neutral, ChoreKind::Floors, 0.5, 0.0, 0.0), 0.0);
        assert_eq!(
            enjoyment(
                &ChoreProfile {
                    preferences: [80, -80, 0, 0],
                    ..neutral.clone()
                },
                ChoreKind::Floors
            ),
            -0.8
        );
        assert_eq!(
            enjoyment(
                &ChoreProfile {
                    preferences: [80, -80, 0, 0],
                    ..neutral
                },
                ChoreKind::Dishes
            ),
            0.8
        );
    }

    #[test]
    fn weekly_assignment_uses_chore_preference_and_balances_work_without_responsibility_bias() {
        let key = ChoreKey {
            kind: ChoreKind::Floors,
            target: 0,
        };
        let profiles = [
            ChoreProfile {
                preferences: [0, -100, 0, 0],
                ..ChoreProfile::neutral(0)
            },
            ChoreProfile {
                preferences: [0, 100, 0, 0],
                ..ChoreProfile::neutral(1)
            },
        ];
        let employed = |profile| Assignee {
            profile,
            unemployed: false,
        };
        let candidates = profiles.each_ref().map(employed);
        let preferred = (0..512)
            .filter(|seed| {
                assign(
                    &[(key, 100)],
                    &candidates,
                    0,
                    &mut SimRng::from_seed(*seed),
                    &[],
                )[0]
                .owner
                    == 1
            })
            .count();
        assert!(preferred > 400);
        let mut changed = profiles.clone();
        changed[0].responsibility = 0;
        changed[1].responsibility = 100;
        let keys = (0..8)
            .map(|target| (ChoreKey { target, ..key }, 100))
            .collect::<Vec<_>>();
        let a = assign(&keys, &candidates, 3, &mut SimRng::from_seed(27), &[]);
        assert_eq!(
            a,
            assign(
                &keys,
                &changed.each_ref().map(employed),
                3,
                &mut SimRng::from_seed(27),
                &[]
            )
        );
        assert_eq!(a.iter().filter(|a| a.owner == 0).count(), 4);
    }
}
