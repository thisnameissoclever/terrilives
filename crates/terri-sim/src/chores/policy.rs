use terri_core::chores::{ChoreKind, ChoreProfile};

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

pub fn assign(
    keys: &[(terri_core::chores::ChoreKey, u32)],
    profiles: &[ChoreProfile],
    week: u64,
    rng: &mut terri_core::SimRng,
) -> Vec<terri_core::chores::ChoreAssignment> {
    assign_with_existing(keys, profiles, week, rng, &[])
}

pub(super) fn assign_with_existing(
    keys: &[(terri_core::chores::ChoreKey, u32)],
    profiles: &[ChoreProfile],
    week: u64,
    rng: &mut terri_core::SimRng,
    existing: &[terri_core::chores::ChoreAssignment],
) -> Vec<terri_core::chores::ChoreAssignment> {
    if profiles.is_empty() {
        return vec![];
    }
    let mut work = vec![0u32; profiles.len()];
    let mut assignments: Vec<_> = existing
        .iter()
        .filter(|a| {
            keys.iter().any(|(k, _)| *k == a.key) && profiles.iter().any(|p| p.sim_id == a.owner)
        })
        .cloned()
        .collect();
    for assignment in &assignments {
        let index = profiles
            .iter()
            .position(|p| p.sim_id == assignment.owner)
            .unwrap();
        work[index] += keys.iter().find(|(k, _)| *k == assignment.key).unwrap().1;
    }
    let mut ordered: Vec<_> = keys
        .iter()
        .copied()
        .filter(|(key, _)| !assignments.iter().any(|a| a.key == *key))
        .collect();
    ordered.sort_by_key(|(key, cost)| (std::cmp::Reverse(*cost), *key));
    for (key, cost) in ordered {
        let min = *work.iter().min().unwrap();
        let choices: Vec<_> = profiles
            .iter()
            .enumerate()
            .filter(|(i, _)| work[*i] <= min.saturating_add(cost / 2))
            .map(|(i, p)| (i, 1.2 + f32::from(p.preferences[key.kind.index()]) / 100.0))
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
        work[selected] = work[selected].saturating_add(cost);
        assignments.push(terri_core::chores::ChoreAssignment {
            key,
            owner: profiles[selected].sim_id,
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
        use terri_core::chores::ChoreKey;
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
        let preferred = (0..512)
            .filter(|seed| {
                assign(
                    &[(key, 100)],
                    &profiles,
                    0,
                    &mut terri_core::SimRng::from_seed(*seed),
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
        let a = assign(&keys, &profiles, 3, &mut terri_core::SimRng::from_seed(27));
        assert_eq!(
            a,
            assign(&keys, &changed, 3, &mut terri_core::SimRng::from_seed(27))
        );
        assert_eq!(a.iter().filter(|a| a.owner == 0).count(), 4);
    }
}
