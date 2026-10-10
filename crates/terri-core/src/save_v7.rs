//! Published schema 7 retains exactly three book-command variants.
use crate::save_v6::*;
use crate::{books::SavedBookLibrary, SaveSnapshotV5, SaveSnapshotV6};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FrozenBookCommand {
    Purchase {
        title: String,
        shelf: Option<u32>,
    },
    Transfer {
        copy: u32,
        shelf: Option<u32>,
    },
    Read {
        agent: u32,
        object: u32,
        action: String,
        title: String,
        front: bool,
    },
}

impl From<FrozenBookCommand> for crate::command::BookCommand {
    fn from(value: FrozenBookCommand) -> Self {
        use FrozenBookCommand::*;
        match value {
            Purchase { title, shelf } => Self::Purchase { title, shelf },
            Transfer { copy, shelf } => Self::Transfer { copy, shelf },
            Read {
                agent,
                object,
                action,
                title,
                front,
            } => Self::Read {
                agent,
                object,
                action,
                title,
                front,
            },
        }
    }
}

pub(crate) mod historical_book_commands {
    use super::*;
    use crate::command::BookCommand;
    pub fn serialize<S: serde::Serializer>(
        value: &[Option<BookCommand>],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let frozen: Result<Vec<_>, _> = value
            .iter()
            .map(|command| {
                command
                    .as_ref()
                    .map(|command| match command {
                        BookCommand::Purchase { title, shelf } => Ok(FrozenBookCommand::Purchase {
                            title: title.clone(),
                            shelf: *shelf,
                        }),
                        BookCommand::Transfer { copy, shelf } => Ok(FrozenBookCommand::Transfer {
                            copy: *copy,
                            shelf: *shelf,
                        }),
                        BookCommand::Read {
                            agent,
                            object,
                            action,
                            title,
                            front,
                        } => Ok(FrozenBookCommand::Read {
                            agent: *agent,
                            object: *object,
                            action: action.clone(),
                            title: title.clone(),
                            front: *front,
                        }),
                        _ => Err(serde::ser::Error::custom(
                            "book command is newer than the historical format",
                        )),
                    })
                    .transpose()
            })
            .collect();
        frozen?.serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<Option<BookCommand>>, D::Error> {
        let frozen = Vec::<Option<FrozenBookCommand>>::deserialize(deserializer)?;
        Ok(frozen
            .into_iter()
            .map(|command| command.map(Into::into))
            .collect())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrozenSaveSnapshotV7 {
    #[serde(with = "crate::save_v6::current_legacy")]
    pub legacy: SaveSnapshotV5,
    pub actions: SavedActionManifest,
    pub books: SavedBookLibrary,
    pub seats: Vec<SavedPhysicalSeat>,
    pub queues: Vec<SavedOrderQueue>,
    pub reading: Vec<SavedReadingJourney>,
    pub pending_shifts: Vec<SavedPendingShift>,
    #[serde(with = "historical_book_commands")]
    pub command_order: Vec<Option<crate::command::BookCommand>>,
    pub chain_origins: Vec<SavedChainOrigin>,
    pub recipe_orders: Vec<(u32, u64)>,
}

impl FrozenSaveSnapshotV7 {
    pub fn into_current(self) -> SaveSnapshotV6 {
        SaveSnapshotV6 {
            legacy: self.legacy,
            actions: self.actions,
            books: self.books,
            seats: self.seats,
            queues: self.queues,
            reading: self.reading,
            pending_shifts: self.pending_shifts,
            command_order: self.command_order,
            chain_origins: self.chain_origins,
            recipe_orders: self.recipe_orders,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_command_tags_stay_exact_and_new_commands_cannot_decode_as_old() {
        use crate::command::BookCommand;
        let old = BookCommand::Purchase {
            title: "x".into(),
            shelf: None,
        };
        let bytes = postcard::to_allocvec(&old).unwrap();
        assert_eq!(bytes, vec![0, 1, b'x', 0]);
        assert_eq!(
            BookCommand::from(postcard::from_bytes::<FrozenBookCommand>(&bytes).unwrap()),
            old
        );
        let newer = BookCommand::Recover { copy: 2 };
        assert_eq!(postcard::to_allocvec(&newer).unwrap(), vec![5, 2]);
        assert!(postcard::from_bytes::<FrozenBookCommand>(&[5, 2]).is_err());
    }
}
