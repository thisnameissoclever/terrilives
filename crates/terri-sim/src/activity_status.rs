//! Read-only context for current activity and the reason for a committed wait.
use crate::{
    social_episode::requests::{self, WaitReason},
    Sim,
};
use terri_core::{
    Agent, AtWork, Blocked, ChainState, Commuting, Eating, NeedId, Needs, Path, Reserved, SimName,
    Socialising, StepWork, Target, Wander,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivityStatus {
    /// 0 active, 1 approaching chat, 2 waiting chat, 3 work wait,
    /// 4 privacy wait, 5 route blocked, 6 unavailable relief, 7 stroll pause, 8 idle.
    pub code: u32,
    pub partner: Option<u32>,
    pub needs: u8,
}

impl Sim {
    pub fn activity_status_of(&self, index: u32) -> Option<ActivityStatus> {
        let world = self.world();
        let person = world
            .try_query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Agent>>()?
            .iter(world)
            .find(|e| e.index_u32() == index)?;
        let active = || {
            Some(ActivityStatus {
                code: 0,
                partner: None,
                needs: 0,
            })
        };
        if world.get::<AtWork>(person).is_some()
            || world.get::<Commuting>(person).is_some()
            || world.get::<Reserved>(person).is_some()
            || world.get::<Eating>(person).is_some()
            || world.get::<StepWork>(person).is_some()
            || world
                .get::<crate::reading::ReadingJourney>(person)
                .is_some()
            || world.get::<Socialising>(person).is_some()
            || world
                .try_query::<&Socialising>()
                .is_some_and(|mut q| q.iter(world).any(|s| s.partner == person))
        {
            return active();
        }
        if world.get::<ChainState>(person).is_some()
            && world
                .get::<Target>(person)
                .is_none_or(|t| t.interaction == crate::systems::chain::CHAIN_STEP)
        {
            return active();
        }
        if let Some((partner, reason)) = requests::status(world, person) {
            let code = if world.get::<Path>(person).is_some() {
                1
            } else {
                match reason {
                    WaitReason::Busy | WaitReason::Queued => 2,
                    WaitReason::Work => 3,
                    WaitReason::Privacy => 4,
                    WaitReason::NoRoute => 5,
                }
            };
            return Some(ActivityStatus {
                code,
                partner: Some(partner.index_u32()),
                needs: 0,
            });
        }
        if world.get::<Path>(person).is_some() {
            return active();
        }
        let critical = world.get::<Needs>(person).map_or(0, |needs| {
            NeedId::ALL.into_iter().fold(0, |mask, n| {
                if needs.get(n)
                    <= world
                        .resource::<crate::Content>()
                        .0
                        .tuning
                        .mood_critical_need_level
                {
                    mask | (1 << n.index())
                } else {
                    mask
                }
            })
        });
        let no_relief = critical != 0
            && world
                .get_resource::<crate::systems::autonomy::DecisionTelemetry>()
                .and_then(|telemetry| telemetry.0.iter().find(|d| d.agent == index))
                .is_some_and(|d| d.relief_masks.iter().all(|m| *m == 0));
        if no_relief {
            return Some(ActivityStatus {
                code: 6,
                partner: None,
                needs: critical,
            });
        }
        if world
            .get::<Wander>(person)
            .is_some_and(|w| w.pause_ticks > 0)
        {
            return Some(ActivityStatus {
                code: 7,
                partner: None,
                needs: 0,
            });
        }
        if world.get::<Blocked>(person).is_some() {
            return active();
        }
        Some(ActivityStatus {
            code: 8,
            partner: None,
            needs: 0,
        })
    }

    pub(crate) fn conversation_wait_label(&self, index: u32) -> Option<String> {
        let status = self.activity_status_of(index)?;
        if !(2..=5).contains(&status.code) {
            return None;
        }
        let name = status
            .partner
            .and_then(|id| {
                self.world()
                    .try_query::<(terri_core::Entity, &SimName)>()
                    .and_then(|mut q| {
                        q.iter(self.world())
                            .find(|(e, _)| e.index_u32() == id)
                            .map(|(_, n)| n.0.clone())
                    })
            })
            .unwrap_or_else(|| "another Sim".into());
        Some(match status.code {
            3 => format!("Waiting for {name} to return from work"),
            4 => format!("Waiting outside to talk to {name}"),
            5 => format!("No route to {name}"),
            _ => format!("Waiting to talk to {name}"),
        })
    }
}
