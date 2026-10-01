use std::collections::{BTreeMap, BTreeSet};
use terri_core::{Agent, Entity, Relationships, SimClock, SimId};
use terri_sim::{relationship_effects::RelationshipCause, Sim};

#[derive(Default)]
pub struct Summary {
    contributions: BTreeMap<RelationshipCause, (u64, f64, f64)>,
    incidents: u64,
    emergencies: u64,
    directed: u64,
    contact_minutes: u64,
    waiting_minutes: u64,
    max_wait: u64,
    pending: Vec<(SimId, SimId, f32, u64)>,
    recovered: Vec<u64>,
    already_within_tolerance: u64,
}
impl Summary {
    pub fn observe(&mut self, sim: &Sim) {
        let tick = sim.world().resource::<SimClock>().tick;
        let mut people = BTreeMap::new();
        if let Some(mut query) = sim
            .world()
            .try_query_filtered::<(Entity, &SimId), bevy_ecs::prelude::With<Agent>>()
        {
            for (entity, &id) in query.iter(sim.world()) {
                people.insert(id, entity);
            }
        }
        let feeling = |a, b| {
            people
                .get(&a)
                .and_then(|&e| sim.world().get::<Relationships>(e))
                .map_or(0.0, |r| r.feeling(b))
        };
        self.contact_minutes += sim.relationship_contacts().len() as u64;
        for &(_, _, elapsed) in sim.privacy_waits() {
            self.waiting_minutes += 1;
            self.max_wait = self.max_wait.max(elapsed);
        }
        let mut seen = BTreeSet::new();
        for e in sim.relationship_effects() {
            let row = self.contributions.entry(e.cause).or_default();
            row.0 += 1;
            row.1 += f64::from(e.requested);
            row.2 += f64::from(e.actual);
            if matches!(
                e.cause,
                RelationshipCause::PrivacyEntry | RelationshipCause::PrivacyStart
            ) {
                if seen.insert((e.event, e.responsible)) {
                    if e.directed {
                        self.directed += 1;
                    } else if e.emergency {
                        self.emergencies += 1;
                    } else {
                        self.incidents += 1;
                    }
                }
                if e.actual >= -0.01 {
                    self.already_within_tolerance += 1;
                    continue;
                }
                // Undo every later contribution to this direction to recover its pre-incident affinity.
                let later: f32 = sim
                    .relationship_effects()
                    .iter()
                    .skip_while(|later| !std::ptr::eq(*later, e))
                    .filter(|later| {
                        later.affected == e.affected && later.responsible == e.responsible
                    })
                    .map(|later| later.actual)
                    .sum();
                self.pending.push((
                    e.affected,
                    e.responsible,
                    feeling(e.affected, e.responsible) - later,
                    tick,
                ));
            }
        }
        self.pending.retain(|&(a, b, before, started)| {
            if feeling(a, b) >= before - 0.01 {
                self.recovered.push(tick - started);
                false
            } else {
                true
            }
        });
    }
    pub fn print(&self, sim: &Sim) {
        println!("\nRELATIONSHIP EFFECTS (records / requested / actual after clamping)");
        for (cause, (records, wanted, actual)) in &self.contributions {
            println!("  {cause:?}: {records} / {wanted:.6} / {actual:.6}");
        }
        println!(
            "  privacy actions: {} ordinary / {} emergency / {} player-directed",
            self.incidents, self.emergencies, self.directed
        );
        println!(
            "  directional contact hours: {:.2}; privacy waiting minutes: {}; longest wait: {}",
            self.contact_minutes as f64 / 60.0,
            self.waiting_minutes,
            self.max_wait
        );
        let mut recovery = self.recovered.clone();
        recovery.sort_unstable();
        println!("  recoveries: {} finished / {} unfinished (subsequent incidents remain in each recovery)",recovery.len(),self.pending.len());
        println!(
            "  privacy victim records already within 0.01 tolerance: {}",
            self.already_within_tolerance
        );
        if !recovery.is_empty() {
            println!(
                "  recovery days: mean {:.3} / median {:.3} / p90 {:.3}",
                recovery.iter().sum::<u64>() as f64 / recovery.len() as f64 / 1440.0,
                (recovery[(recovery.len() - 1) / 2] as f64 + recovery[recovery.len() / 2] as f64)
                    / 2.0
                    / 1440.0,
                recovery[(recovery.len() * 9).div_ceil(10) - 1] as f64 / 1440.0
            );
        }
        if let Some(mut query) = sim.world().try_query::<(&SimId, &Relationships)>() {
            for (id, r) in query.iter(sim.world()) {
                for &(other, value) in r.entries() {
                    if value <= -0.5 {
                        println!("  hostile: {} toward {} ({value:.4})", id.0, other.0);
                    }
                }
            }
        }
    }
}
