//! Physical reward arithmetic shared by delivery and decision forecasts.
use terri_core::{NeedId, Personality, NEED_COUNT};

pub(crate) type Effects = [f32; NEED_COUNT];

pub(crate) struct ObjectContext {
    pub social_available: bool,
    pub shared: bool,
    pub seat_rate: f32,
    pub company: f32,
}

pub(crate) fn support_rate(delta: f32, satisfaction: f32) -> f32 {
    crate::systems::advertise::scaled_delta(delta, satisfaction)
}

pub(crate) fn shared_rate(delta: f32, satisfaction: f32, company: f32) -> f32 {
    delta * satisfaction * company
}

pub(crate) fn object_effects(
    pack: &terri_data::ContentPack,
    action: &terri_data::CompiledInteraction,
    personality: &Personality,
    context: ObjectContext,
) -> Effects {
    let rows: Vec<_> = action
        .advertises
        .iter()
        .copied()
        .filter(|(n, d)| {
            crate::social_company::effective_delta(
                *n,
                *d,
                context.social_available || crate::social_company::solo_social(action),
            )
        })
        .collect();
    let mut effects = ordinary_effects(
        &rows,
        personality,
        crate::social_company::social_scale(action, context.company),
        action.duration_ticks,
    );
    if !crate::seating::work_action(action) {
        effects[NeedId::Comfort.index()] += support_rate(
            context.seat_rate,
            personality.satisfaction[NeedId::Comfort.index()],
        );
    }
    if context.shared
        && !action
            .advertises
            .iter()
            .any(|(n, d)| usize::from(*n) == NeedId::Social.index() && *d > 0.)
    {
        effects[NeedId::Social.index()] += shared_rate(
            pack.tuning.need_interactions.shared_social_per_tick,
            personality.satisfaction[NeedId::Social.index()],
            context.company,
        );
    }
    effects
}

pub(crate) fn ordinary_rate(
    delta: f32,
    satisfaction: f32,
    failure: f32,
    company: f32,
    duration: u32,
) -> f32 {
    crate::systems::advertise::scaled_delta(delta, satisfaction * failure * company)
        / duration as f32
}

pub(crate) fn ordinary_effects(
    rows: &[(u8, f32)],
    personality: &Personality,
    company: f32,
    duration: u32,
) -> Effects {
    let mut effects = [0.; NEED_COUNT];
    for &(need, delta) in rows {
        let index = usize::from(need);
        effects[index] += ordinary_rate(
            delta,
            personality.satisfaction[index],
            1.,
            if index == NeedId::Social.index() {
                company
            } else {
                1.
            },
            duration,
        );
    }
    effects
}

pub(crate) fn conversation_rate(
    delta: f32,
    satisfaction: f32,
    relationship: f32,
    duration: u32,
) -> f32 {
    crate::systems::advertise::scaled_delta(delta, relationship * satisfaction) / duration as f32
}

pub(crate) fn conversation_effects(
    rows: &[(u8, f32)],
    personality: &Personality,
    social: f32,
    other: f32,
    duration: u32,
) -> Effects {
    let mut effects = [0.; NEED_COUNT];
    for &(need, delta) in rows {
        let index = usize::from(need);
        effects[index] += conversation_rate(
            delta,
            personality.satisfaction[index],
            if index == NeedId::Social.index() {
                social
            } else {
                other
            },
            duration,
        );
    }
    effects
}

pub(crate) fn terminal_delta(delta: f32, satisfaction: f32, failure: f32) -> f32 {
    crate::systems::advertise::scaled_delta(delta, satisfaction * failure)
}

pub(crate) fn terminal_effects(rows: &[(u8, f32)], personality: &Personality) -> Effects {
    let mut effects = [0.; NEED_COUNT];
    for &(need, delta) in rows {
        if usize::from(need) == NeedId::Social.index() && delta > 0. {
            continue;
        }
        effects[usize::from(need)] +=
            terminal_delta(delta, personality.satisfaction[usize::from(need)], 1.);
    }
    effects
}

pub(crate) fn reading_effects(
    fun: f32,
    comfort: f32,
    work_reward_factor: f32,
    taste: f32,
    failure: f32,
    personality: &Personality,
) -> Effects {
    let mut effects = [0.; NEED_COUNT];
    effects[NeedId::Fun.index()] =
        work_reward_factor * taste * failure * fun * personality.satisfaction[NeedId::Fun.index()];
    effects[NeedId::Comfort.index()] =
        comfort * failure * personality.satisfaction[NeedId::Comfort.index()];
    effects
}
