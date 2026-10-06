//! Stable public actions and deliberately retained accounting aliases.
use terri_core::ObjectDefId;
use terri_data::{CompiledChain, CompiledInteraction, ContentPack};

#[derive(Clone, Copy)]
pub struct ActionRow<'a> {
    pub row: u32,
    pub action: Option<&'a CompiledInteraction>,
    pub recipe: Option<(usize, &'a CompiledChain)>,
    pub public: bool,
}

impl<'a> ActionRow<'a> {
    pub fn authored_label(self) -> &'a str {
        self.action.map_or_else(
            || self.recipe.expect("alias recipe").1.label.as_str(),
            |action| action.label.as_str(),
        )
    }
    pub fn key(self) -> String {
        if let Some(action) = self.action {
            format!("interaction:{}", action.id)
        } else {
            format!("chain:{}", self.recipe.expect("alias recipe").1.id)
        }
    }
    pub fn label(self, tick: u64, day_ticks: u32) -> &'a str {
        if self.recipe.is_some_and(|(_, c)| c.id == "cook_dinner") {
            crate::domestic::meal_label(tick, day_ticks)
        } else if let Some(action) = self.action {
            &action.label
        } else {
            &self.recipe.expect("alias recipe").1.label
        }
    }
}

/// Historical append-only rows survive only as accounting aliases in current content.
pub fn rows(pack: &ContentPack, model: ObjectDefId) -> Vec<ActionRow<'_>> {
    let object = pack.object(model);
    let historical = terri_data::is_pre_books_pack(pack);
    let mut result: Vec<_> = object
        .interactions
        .iter()
        .enumerate()
        .map(|(row, action)| ActionRow {
            row: row as u32,
            action: Some(action),
            recipe: crate::domestic::interaction_chain(pack, action),
            public: true,
        })
        .collect();
    for (index, chain) in pack
        .chains
        .iter()
        .enumerate()
        .filter(|(_, c)| c.advertised_by == model)
    {
        if !historical
            && result
                .iter()
                .any(|row| row.recipe.is_some_and(|(i, _)| i == index))
            && !crate::domestic::hidden_chain(&chain.id)
        {
            continue;
        }
        result.push(ActionRow {
            row: result.len() as u32,
            action: None,
            recipe: Some((index, chain)),
            public: historical && !crate::domestic::hidden_chain(&chain.id),
        });
    }
    result
}

pub fn resolve(pack: &ContentPack, model: ObjectDefId, row: u32) -> Option<ActionRow<'_>> {
    rows(pack, model).into_iter().find(|a| a.row == row)
}

pub fn aliases(
    pack: &ContentPack,
    model: ObjectDefId,
) -> impl Iterator<Item = (usize, &CompiledChain)> {
    rows(pack, model)
        .into_iter()
        .filter(|a| a.action.is_none())
        .filter_map(|a| a.recipe)
}
