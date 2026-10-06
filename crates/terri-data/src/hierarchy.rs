//! Resolve category, physical type, and model layers before runtime compilation.

use crate::error::ContentError;
use crate::pack::{ModelMetadata, ObjectPresentation, SleepPlaceAccess};
use crate::schema::{ActionSocketDef, InteractionDef, ObjectDef, ObjectsFile, SeatDef, VisualDef};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::Footprint;

/// Exactly one operation is permitted per authored field and layer.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operation<T> {
    pub set: Option<T>,
    pub scale: Option<f64>,
    pub remove: Option<bool>,
    pub extend: Option<T>,
    pub replace: Option<T>,
}

impl<T> Default for Operation<T> {
    fn default() -> Self {
        Self {
            set: None,
            scale: None,
            remove: None,
            extend: None,
            replace: None,
        }
    }
}

fn invalid(context: &str, reason: impl Into<String>) -> ContentError {
    ContentError::InvalidHierarchy {
        context: context.into(),
        reason: reason.into(),
    }
}

impl<T: Clone> Operation<T> {
    fn count(&self) -> usize {
        usize::from(self.set.is_some())
            + usize::from(self.scale.is_some())
            + usize::from(self.remove.is_some())
            + usize::from(self.extend.is_some())
            + usize::from(self.replace.is_some())
    }

    fn check(&self, context: &str) -> Result<(), ContentError> {
        if self.count() > 1 {
            return Err(invalid(context, "conflicting operations on one field"));
        }
        if self.remove == Some(false) {
            return Err(invalid(context, "remove must be true"));
        }
        Ok(())
    }

    fn scalar(
        &self,
        target: &mut Option<T>,
        optional: bool,
        context: &str,
    ) -> Result<(), ContentError> {
        self.check(context)?;
        if self.scale.is_some() || self.extend.is_some() || self.replace.is_some() {
            return Err(invalid(context, "this field accepts set or remove"));
        }
        if let Some(value) = &self.set {
            *target = Some(value.clone());
        }
        if self.remove == Some(true) {
            if !optional {
                return Err(invalid(context, "cannot remove a required field"));
            }
            if target.take().is_none() {
                return Err(invalid(context, "cannot remove an absent field"));
            }
        }
        Ok(())
    }
}

impl Operation<f64> {
    fn number(
        &self,
        target: &mut Option<f64>,
        optional: bool,
        context: &str,
    ) -> Result<(), ContentError> {
        self.check(context)?;
        if let Some(factor) = self.scale {
            if !factor.is_finite() || factor < 0.0 {
                return Err(invalid(context, "scale must be finite and non-negative"));
            }
            let value = target
                .as_mut()
                .ok_or_else(|| invalid(context, "cannot scale an absent field"))?;
            *value *= factor;
            if !value.is_finite() {
                return Err(invalid(context, "scaled value must be finite"));
            }
            Ok(())
        } else {
            self.scalar(target, optional, context)?;
            if target.is_some_and(|value| !value.is_finite()) {
                return Err(invalid(context, "value must be finite"));
            }
            Ok(())
        }
    }
}

impl<T: Clone> Operation<Vec<T>> {
    fn collection(&self, target: &mut Vec<T>, context: &str) -> Result<(), ContentError> {
        self.check(context)?;
        if self.scale.is_some() || self.remove.is_some() {
            return Err(invalid(
                context,
                "collections accept set, extend, or replace",
            ));
        }
        if let Some(value) = self.set.as_ref().or(self.replace.as_ref()) {
            *target = value.clone();
        }
        if let Some(value) = &self.extend {
            target.extend(value.iter().cloned());
        }
        Ok(())
    }
}

impl Operation<BTreeMap<String, f64>> {
    fn adverts(
        &self,
        target: &mut Option<BTreeMap<String, f64>>,
        context: &str,
    ) -> Result<(), ContentError> {
        self.check(context)?;
        if self.remove.is_some() {
            return Err(invalid(
                context,
                "cannot remove required advertises; replace with an empty map",
            ));
        }
        if let Some(value) = self.set.as_ref().or(self.replace.as_ref()) {
            *target = Some(value.clone());
        }
        if let Some(value) = &self.extend {
            let target = target.get_or_insert_with(BTreeMap::new);
            for (need, delta) in value {
                if target.insert(need.clone(), *delta).is_some() {
                    return Err(invalid(
                        context,
                        format!("extend repeats need '{need}'; use replace"),
                    ));
                }
            }
        }
        if let Some(factor) = self.scale {
            if !factor.is_finite() || factor < 0.0 {
                return Err(invalid(context, "scale must be finite and non-negative"));
            }
            let target = target
                .as_mut()
                .ok_or_else(|| invalid(context, "cannot scale absent advertises"))?;
            for value in target.values_mut() {
                *value *= factor;
            }
        }
        if target
            .as_ref()
            .is_some_and(|map| map.values().any(|v| !v.is_finite()))
        {
            return Err(invalid(context, "advertises must be finite"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ObjectProperties {
    pub cooking_front: Operation<(i32, i32)>,
    pub shelf_capacity: Operation<f64>,
    pub shelf_access: Operation<Vec<(i32, i32)>>,
    pub name: Operation<String>,
    pub sprite: Operation<String>,
    pub description: Operation<String>,
    pub base_facing: Operation<String>,
    pub foreground_sprite: Operation<String>,
    pub price: Operation<f64>,
    pub footprint: Operation<Footprint>,
    pub rooms: Operation<Vec<String>>,
    pub roles: Operation<Vec<String>>,
    pub action_socket: Operation<Vec<ActionSocketDef>>,
    pub sleep_place: Operation<Vec<SleepPlaceAccess>>,
    pub seat: Operation<Vec<SeatDef>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActionProperties {
    pub media: Operation<crate::pack::MediaBehavior>,
    pub recipe: Operation<crate::pack::RecipeDef>,
    pub book_reading: Operation<bool>,
    pub seat_use: Operation<crate::pack::SeatUse>,
    pub label: Operation<String>,
    pub advertises: Operation<BTreeMap<String, f64>>,
    pub duration_ticks: Operation<f64>,
    pub slots: Operation<f64>,
    pub tags: Operation<Vec<String>>,
    pub satisfaction: Operation<f64>,
    pub visual: Operation<VisualDef>,
    pub sound_action: Operation<String>,
    pub shared_activity: Operation<String>,
    pub activity: Operation<String>,
    pub completion_sound: Operation<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionLayer {
    pub id: String,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub remove: bool,
    #[serde(default)]
    pub properties: ActionProperties,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionTemplate {
    pub id: String,
    pub properties: ActionProperties,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryDef {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub properties: ObjectProperties,
    #[serde(default)]
    pub action: Vec<ActionLayer>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObjectTypeDef {
    pub id: String,
    pub label: String,
    pub category: String,
    #[serde(default)]
    pub properties: ObjectProperties,
    #[serde(default)]
    pub action: Vec<ActionLayer>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDef {
    pub id: String,
    pub object_type: String,
    #[serde(default)]
    pub properties: ObjectProperties,
    #[serde(default)]
    pub action: Vec<ActionLayer>,
}

#[derive(Default)]
struct ObjectState {
    cooking_front: Option<(i32, i32)>,
    shelf_capacity: Option<f64>,
    shelf_access: Vec<(i32, i32)>,
    name: Option<String>,
    sprite: Option<String>,
    description: Option<String>,
    base_facing: Option<String>,
    foreground_sprite: Option<String>,
    price: Option<f64>,
    footprint: Option<Footprint>,
    rooms: Vec<String>,
    roles: Vec<String>,
    action_socket: Vec<ActionSocketDef>,
    sleep_place: Vec<SleepPlaceAccess>,
    seat: Vec<SeatDef>,
    actions: Vec<ActionState>,
}

#[derive(Default)]
struct ActionState {
    media: Option<crate::pack::MediaBehavior>,
    recipe: Option<crate::pack::RecipeDef>,
    book_reading: Option<bool>,
    seat_use: Option<crate::pack::SeatUse>,
    id: String,
    label: Option<String>,
    advertises: Option<BTreeMap<String, f64>>,
    duration_ticks: Option<f64>,
    slots: Option<f64>,
    tags: Vec<String>,
    satisfaction: Option<f64>,
    visual: Option<VisualDef>,
    sound_action: Option<String>,
    shared_activity: Option<String>,
    activity: Option<String>,
    completion_sound: Option<String>,
}

impl ObjectState {
    fn apply(&mut self, properties: &ObjectProperties, context: &str) -> Result<(), ContentError> {
        macro_rules! scalar {
            ($field:ident, $optional:expr) => {
                properties.$field.scalar(
                    &mut self.$field,
                    $optional,
                    &format!("{context}.{}", stringify!($field)),
                )?
            };
        }
        macro_rules! collection {
            ($field:ident) => {
                properties.$field.collection(
                    &mut self.$field,
                    &format!("{context}.{}", stringify!($field)),
                )?
            };
        }
        scalar!(name, false);
        scalar!(cooking_front, true);
        if self
            .cooking_front
            .is_some_and(|front| ![(1, 0), (0, 1), (-1, 0), (0, -1)].contains(&front))
        {
            return Err(invalid(
                context,
                "cooking front must name one adjacent contact",
            ));
        }
        scalar!(sprite, false);
        scalar!(description, true);
        scalar!(base_facing, true);
        scalar!(foreground_sprite, true);
        scalar!(footprint, false);
        properties.shelf_capacity.number(
            &mut self.shelf_capacity,
            true,
            &format!("{context}.shelf_capacity"),
        )?;
        properties
            .price
            .number(&mut self.price, true, &format!("{context}.price"))?;
        collection!(rooms);
        collection!(roles);
        collection!(action_socket);
        collection!(sleep_place);
        collection!(shelf_access);
        collection!(seat);
        Ok(())
    }

    fn actions(
        &mut self,
        layers: &[ActionLayer],
        templates: &BTreeMap<&str, &ActionTemplate>,
        context: &str,
    ) -> Result<(), ContentError> {
        let mut seen = BTreeSet::new();
        for layer in layers {
            let context = format!("{context}.action.{}", layer.id);
            identifier(&layer.id, &context)?;
            if !seen.insert(&layer.id) {
                return Err(invalid(&context, "action appears twice in one layer"));
            }
            let index = self.actions.iter().position(|action| action.id == layer.id);
            if layer.remove {
                if layer.template.is_some() || layer.properties.has_operations() {
                    return Err(invalid(
                        &context,
                        "remove conflicts with template or properties",
                    ));
                }
                let index =
                    index.ok_or_else(|| invalid(&context, "cannot remove an unknown action"))?;
                self.actions.remove(index);
                continue;
            }
            let index = index.unwrap_or_else(|| {
                self.actions.push(ActionState {
                    id: layer.id.clone(),
                    ..ActionState::default()
                });
                self.actions.len() - 1
            });
            let action = &mut self.actions[index];
            if let Some(id) = &layer.template {
                let template = templates
                    .get(id.as_str())
                    .ok_or_else(|| invalid(&context, format!("unknown action template '{id}'")))?;
                action.apply(&template.properties, &context)?;
            }
            action.apply(&layer.properties, &context)?;
        }
        Ok(())
    }
}

impl ActionProperties {
    fn has_operations(&self) -> bool {
        self.label.count()
            + self.media.count()
            + self.recipe.count()
            + self.book_reading.count()
            + self.seat_use.count()
            + self.advertises.count()
            + self.duration_ticks.count()
            + self.slots.count()
            + self.tags.count()
            + self.satisfaction.count()
            + self.visual.count()
            + self.sound_action.count()
            + self.shared_activity.count()
            + self.activity.count()
            + self.completion_sound.count()
            > 0
    }
}

impl ActionState {
    fn apply(&mut self, properties: &ActionProperties, context: &str) -> Result<(), ContentError> {
        macro_rules! scalar {
            ($field:ident) => {
                properties.$field.scalar(
                    &mut self.$field,
                    true,
                    &format!("{context}.{}", stringify!($field)),
                )?
            };
        }
        macro_rules! number {
            ($field:ident) => {
                properties.$field.number(
                    &mut self.$field,
                    false,
                    &format!("{context}.{}", stringify!($field)),
                )?
            };
        }
        scalar!(label);
        scalar!(media);
        scalar!(recipe);
        scalar!(visual);
        scalar!(sound_action);
        scalar!(shared_activity);
        scalar!(activity);
        scalar!(completion_sound);
        scalar!(book_reading);
        scalar!(seat_use);
        number!(duration_ticks);
        number!(slots);
        properties.satisfaction.number(
            &mut self.satisfaction,
            true,
            &format!("{context}.satisfaction"),
        )?;
        properties
            .tags
            .collection(&mut self.tags, &format!("{context}.tags"))?;
        properties
            .advertises
            .adverts(&mut self.advertises, &format!("{context}.advertises"))?;
        crate::compile::validate_action_references(properties, context, &self.id)?;
        Ok(())
    }

    fn finish(self, context: &str) -> Result<InteractionDef, ContentError> {
        let context = format!("{context}.action.{}", self.id);
        let duration = required(self.duration_ticks, &context, "duration_ticks")?;
        let duration_ticks = integer(
            duration.round(),
            1.0,
            u32::MAX as f64,
            &context,
            "duration_ticks",
        )? as u32;
        let slots = integer(
            required(self.slots, &context, "slots")?,
            1.0,
            u8::MAX as f64,
            &context,
            "slots",
        )? as u8;
        let advertises = required(self.advertises, &context, "advertises")?
            .into_iter()
            .map(|(need, value)| float(value, &context).map(|value| (need, value)))
            .collect::<Result<_, _>>()?;
        Ok(InteractionDef {
            media: self.media,
            recipe: self.recipe,
            book_reading: self.book_reading.unwrap_or(false),
            seat_use: self.seat_use.unwrap_or_default(),
            id: self.id,
            label: self.label,
            advertises,
            duration_ticks,
            slots,
            tags: self.tags,
            satisfaction: float(self.satisfaction.unwrap_or(0.0), &context)?,
            visual: self.visual,
            sound_action: self.sound_action,
            shared_activity: self.shared_activity,
            activity: self.activity,
            completion_sound: self.completion_sound,
        })
    }
}

fn required<T>(value: Option<T>, context: &str, field: &str) -> Result<T, ContentError> {
    value.ok_or_else(|| {
        invalid(
            context,
            format!("missing required field '{field}' after inheritance"),
        )
    })
}

fn integer(
    value: f64,
    min: f64,
    max: f64,
    context: &str,
    field: &str,
) -> Result<f64, ContentError> {
    if !value.is_finite() || value < min || value > max || value.fract() != 0.0 {
        return Err(invalid(
            context,
            format!("'{field}' must resolve to an integer in {min}..={max}"),
        ));
    }
    Ok(value)
}

fn float(value: f64, context: &str) -> Result<f32, ContentError> {
    let value = value as f32;
    if !value.is_finite() {
        return Err(invalid(context, "value exceeds the finite f32 range"));
    }
    Ok(value)
}

fn identifier(id: &str, context: &str) -> Result<(), ContentError> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(invalid(
            context,
            "IDs use lowercase ASCII letters, digits, and underscores",
        ));
    }
    Ok(())
}

fn index<'a, T>(
    entries: &'a [T],
    id: impl Fn(&'a T) -> &'a str,
    kind: &str,
) -> Result<BTreeMap<&'a str, &'a T>, ContentError> {
    let mut result = BTreeMap::new();
    for entry in entries {
        let name = id(entry);
        identifier(name, kind)?;
        if result.insert(name, entry).is_some() {
            return Err(invalid(kind, format!("duplicate ID '{name}'")));
        }
    }
    Ok(result)
}

/// Legacy objects retain their authored order; hierarchical models follow in authored order.
pub fn resolve(mut source: ObjectsFile) -> Result<ObjectsFile, ContentError> {
    let categories = index(&source.category, |entry| &entry.id, "category")?;
    let types = index(&source.object_type, |entry| &entry.id, "object_type")?;
    let templates = index(
        &source.action_template,
        |entry| &entry.id,
        "action_template",
    )?;
    index(&source.model, |entry| &entry.id, "model")?;
    for template in &source.action_template {
        let context = format!("action_template.{}", template.id);
        let mut state = ActionState {
            id: template.id.clone(),
            ..ActionState::default()
        };
        state.apply(&template.properties, &context)?;
    }
    for category in &source.category {
        if category.label.trim().is_empty() {
            return Err(invalid(&category.id, "category label must not be blank"));
        }
        let mut state = ObjectState::default();
        state.apply(&category.properties, &category.id)?;
        state.actions(&category.action, &templates, &category.id)?;
    }
    for kind in &source.object_type {
        if kind.label.trim().is_empty() {
            return Err(invalid(&kind.id, "type label must not be blank"));
        }
        if !categories.contains_key(kind.category.as_str()) {
            return Err(invalid(
                &kind.id,
                format!("unknown category '{}'", kind.category),
            ));
        }
        let category = categories[kind.category.as_str()];
        let mut state = ObjectState::default();
        state.apply(&category.properties, &category.id)?;
        state.actions(&category.action, &templates, &category.id)?;
        state.apply(&kind.properties, &kind.id)?;
        state.actions(&kind.action, &templates, &kind.id)?;
    }
    let mut resolved = Vec::new();
    for model in &source.model {
        let kind = types.get(model.object_type.as_str()).ok_or_else(|| {
            invalid(
                &model.id,
                format!("unknown object type '{}'", model.object_type),
            )
        })?;
        let category = categories[kind.category.as_str()];
        let mut state = ObjectState::default();
        for (properties, actions, context) in [
            (
                &category.properties,
                &category.action,
                format!("category.{}", category.id),
            ),
            (
                &kind.properties,
                &kind.action,
                format!("object_type.{}", kind.id),
            ),
            (
                &model.properties,
                &model.action,
                format!("model.{}", model.id),
            ),
        ] {
            state.apply(properties, &context)?;
            state.actions(actions, &templates, &context)?;
        }
        let mut rooms = BTreeSet::new();
        for room in state.rooms {
            identifier(&room, &model.id)?;
            if !rooms.insert(room) {
                return Err(invalid(&model.id, "room associations must be unique"));
            }
        }
        let interactions = state
            .actions
            .into_iter()
            .map(|action| action.finish(&model.id))
            .collect::<Result<_, _>>()?;
        resolved.push(ObjectDef {
            cooking_front: state.cooking_front,
            shelf_access: state.shelf_access,
            shelf_capacity: integer(
                state.shelf_capacity.unwrap_or(0.0),
                0.0,
                u16::MAX as f64,
                &model.id,
                "shelf_capacity",
            )? as u16,
            id: model.id.clone(),
            name: required(state.name, &model.id, "name")?,
            sprite: required(state.sprite, &model.id, "sprite")?,
            presentation: state.description.map(|description| ObjectPresentation {
                object_type: kind.label.clone(),
                description,
            }),
            base_facing: state.base_facing,
            foreground_sprite: state.foreground_sprite,
            price: state
                .price
                .map(|price| {
                    integer(price, 1.0, u32::MAX as f64, &model.id, "price").map(|p| p as u32)
                })
                .transpose()?,
            footprint: state.footprint.unwrap_or_default(),
            interaction: interactions,
            roles: state.roles,
            action_socket: state.action_socket,
            sleep_place: state.sleep_place,
            metadata: Some(ModelMetadata {
                category_id: category.id.clone(),
                category_label: category.label.clone(),
                type_id: kind.id.clone(),
                type_label: kind.label.clone(),
                rooms: rooms.into_iter().collect(),
            }),
            seat: state.seat,
        });
    }
    source.object.extend(resolved);
    source.model.clear();
    Ok(source)
}
