//! Random creation uses authored bands; explicit values bypass this sampler.
use terri_core::SimRng;
use terri_data::CreationInstinctBand;

pub(crate) fn sample_for_world(world: &mut bevy_ecs::world::World) -> u8 {
    let Some(autonomy) = world.resource::<crate::Content>().0.tuning.autonomy else {
        // Published historical constructors retain their original draws.
        return world.resource_mut::<SimRng>().range(101) as u8;
    };
    sample_creation_instinct(
        &mut world.resource_mut::<SimRng>(),
        &autonomy.creation_instinct_bands,
    )
}

pub(crate) fn sample_creation_instinct(rng: &mut SimRng, bands: &[CreationInstinctBand; 7]) -> u8 {
    draw_with(bands, |bound| rng.range(bound))
}

fn draw_with(bands: &[CreationInstinctBand; 7], mut draw: impl FnMut(usize) -> usize) -> u8 {
    let bucket = draw(100);
    let mut end = 0;
    for band in bands {
        end += usize::from(band.weight);
        if bucket < end {
            return band.min + draw(usize::from(band.max - band.min) + 1) as u8;
        }
    }
    unreachable!("validated creation weights cover every draw")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn each_bucket_boundary_selects_the_authored_band_and_both_endpoints() {
        let bands = terri_data::AutonomyTuning::default().creation_instinct_bands;
        for (first, last, min, max) in [
            (0, 4, 11, 30),
            (5, 14, 31, 50),
            (15, 24, 51, 60),
            (25, 49, 61, 70),
            (50, 79, 71, 80),
            (80, 94, 81, 90),
            (95, 99, 91, 95),
        ] {
            for bucket in [first, last] {
                for offset in [0, max - min] {
                    let mut calls = 0;
                    let value = draw_with(&bands, |bound| {
                        calls += 1;
                        if calls == 1 {
                            assert_eq!(bound, 100);
                            bucket
                        } else {
                            assert_eq!(bound, max - min + 1);
                            offset
                        }
                    });
                    assert_eq!(usize::from(value), min + offset);
                    assert_eq!(calls, 2);
                }
            }
        }
    }
    #[test]
    fn all_one_hundred_band_buckets_have_exactly_the_requested_weights() {
        let bands = terri_data::AutonomyTuning::default().creation_instinct_bands;
        let mut counts = [0; 7];
        for bucket in 0..100 {
            let mut first = true;
            let value = draw_with(&bands, |_| {
                if first {
                    first = false;
                    bucket
                } else {
                    0
                }
            });
            let i = match value {
                11..=30 => 0,
                31..=50 => 1,
                51..=60 => 2,
                61..=70 => 3,
                71..=80 => 4,
                81..=90 => 5,
                91..=95 => 6,
                _ => panic!("player-only value"),
            };
            counts[i] += 1;
        }
        assert_eq!(counts, [5, 10, 10, 25, 30, 15, 5]);
    }
}
