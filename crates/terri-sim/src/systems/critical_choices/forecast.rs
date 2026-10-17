use super::NeedOutcome;
use crate::need_interactions::physical::Effects;
use terri_core::{NeedId, Needs, Personality};
use terri_data::{CompiledInteraction, ContentPack};

pub(crate) enum Phase<'a> {
    Decay(u32),
    Active {
        ticks: u32,
        effects: Effects,
        action: Option<&'a CompiledInteraction>,
        asleep: bool,
    },
    Payment(Effects),
}

pub(crate) fn travel_ticks(distance: f32) -> u32 {
    (distance / super::super::advertise::TILES_PER_TICK).ceil() as u32
}

/// Fold constant phases with the same drain-before-payment and meter bounds as play.
pub(crate) fn predict_phases(
    pack: &ContentPack,
    needs: &Needs,
    personality: &Personality,
    phases: &[Phase<'_>],
) -> NeedOutcome {
    let mut values = *needs;
    let mut outcome = NeedOutcome::default();
    let mut elapsed = 0u32;
    for phase in phases {
        match phase {
            Phase::Decay(ticks) => {
                for need in NeedId::ALL {
                    values.drain(
                        need,
                        pack.decay_per_tick[need.index()]
                            * personality.drain[need.index()]
                            * *ticks as f32,
                    );
                }
                elapsed = elapsed.saturating_add(*ticks);
            }
            Phase::Payment(effects) => {
                for need in NeedId::ALL {
                    let index = need.index();
                    if effects[index] > 0. && outcome.first_relief_ticks[index].is_none() {
                        outcome.first_relief_ticks[index] = Some(elapsed);
                    }
                    values.fill(need, effects[index]);
                }
            }
            Phase::Active {
                ticks,
                effects,
                action,
                asleep,
            } => {
                for need in NeedId::ALL {
                    let index = need.index();
                    let decay = pack.decay_per_tick[index]
                        * personality.drain[index]
                        * if *asleep {
                            pack.tuning.asleep_decay_scale
                        } else {
                            1.
                        };
                    let cap = action.and_then(|a| {
                        crate::need_interactions::restoration_ceiling(pack, a, index as u8)
                    });
                    values.set(
                        need,
                        continuous_end(values.get(need), decay, effects[index], *ticks, cap),
                    );
                    if *ticks > 0
                        && effects[index] > 0.
                        && outcome.first_relief_ticks[index].is_none()
                    {
                        outcome.first_relief_ticks[index] = Some(elapsed.saturating_add(1));
                    }
                }
                elapsed = elapsed.saturating_add(*ticks);
            }
        }
    }
    outcome.completion_ticks = elapsed;
    for need in NeedId::ALL {
        let index = need.index();
        outcome.net_change[index] = values.get(need) - needs.get(need);
        if outcome.net_change[index] <= 0. {
            outcome.first_relief_ticks[index] = None;
        }
    }
    outcome
}

/// Constant rates need no per-tick simulation or unbounded candidate work.
fn continuous_end(mut value: f32, decay: f32, rate: f32, mut ticks: u32, cap: Option<f32>) -> f32 {
    if ticks == 0 {
        return value;
    }
    if rate <= 0. {
        return (value + (rate - decay) * ticks as f32).clamp(0., 100.);
    }
    if let Some(ceiling) = cap.filter(|ceiling| value > *ceiling) {
        if decay == 0. {
            return value;
        }
        let no_payment = (((value - ceiling) / decay).floor() as u32).min(ticks);
        value = (value - decay * no_payment as f32).max(0.);
        ticks -= no_payment;
        if ticks == 0 {
            return value;
        }
        value = (value - decay).max(0.);
        value += rate.min((ceiling - value).max(0.));
        ticks -= 1;
        if ticks == 0 {
            return value;
        }
    }
    let net = rate - decay;
    let after_floor = rate + (ticks - 1) as f32 * net.max(0.);
    (value + net * ticks as f32)
        .max(after_floor)
        .min(cap.unwrap_or(100.))
        .clamp(0., 100.)
}

#[cfg(test)]
mod tests {
    use super::continuous_end;

    #[test]
    fn constant_phase_matches_tick_delivery_across_floor_and_restoration_ceiling() {
        for initial in [0., 10., 39., 40., 41., 80., 100.] {
            for decay in [0., 0.0625, 0.5, 2., 5.] {
                for rate in [-2., 0., 0.125, 1., 5.] {
                    for ticks in [0, 1, 2, 10, 100, 400] {
                        for cap in [None, Some(40.)] {
                            let mut actual: f32 = initial;
                            for _ in 0..ticks {
                                actual = (actual - decay).max(0.);
                                let payment = if rate > 0. {
                                    rate.min((cap.unwrap_or(100.) - actual).max(0.))
                                } else {
                                    rate
                                };
                                actual = (actual + payment).clamp(0., 100.);
                            }
                            let predicted = continuous_end(initial, decay, rate, ticks, cap);
                            assert!(
                                (predicted - actual).abs() < 0.001,
                                "initial={initial} decay={decay} rate={rate} ticks={ticks} cap={cap:?}: predicted={predicted}, actual={actual}"
                            );
                        }
                    }
                }
            }
        }
    }
}
