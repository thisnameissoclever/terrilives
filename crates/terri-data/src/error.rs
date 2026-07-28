use std::fmt;

/// Every way content can be invalid.
///
/// These messages are read by whoever just broke the build, usually
/// somebody editing TOML rather than Rust, so each one names the
/// offending id and enough surrounding context to find the line. Vague
/// wording here is the difference between a five-second fix and a
/// confused half hour.
#[derive(Debug, PartialEq)]
pub enum ContentError {
    UnknownNeed {
        object: String,
        interaction: String,
        need: String,
    },
    MissingNeedDecay {
        need: String,
    },
    UnknownNeedDecay {
        need: String,
    },
    DuplicateNeedDecay {
        need: String,
    },
    DuplicateObjectId {
        id: String,
    },
    DuplicateInteractionId {
        object: String,
        id: String,
    },
    ZeroDuration {
        object: String,
        interaction: String,
    },
    ZeroSlots {
        object: String,
        interaction: String,
    },
    NonFiniteValue {
        context: String,
    },
    NegativeValue {
        context: String,
    },
}

impl fmt::Display for ContentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContentError::UnknownNeed {
                object,
                interaction,
                need,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' advertises unknown need '{need}'"
            ),
            ContentError::MissingNeedDecay { need } => {
                write!(f, "needs.toml is missing a decay rate for '{need}'")
            }
            ContentError::UnknownNeedDecay { need } => {
                write!(f, "needs.toml declares unknown need '{need}'")
            }
            ContentError::DuplicateNeedDecay { need } => {
                write!(f, "needs.toml declares '{need}' more than once")
            }
            ContentError::DuplicateObjectId { id } => {
                write!(f, "duplicate object id '{id}'")
            }
            ContentError::DuplicateInteractionId { object, id } => {
                write!(
                    f,
                    "object '{object}' declares interaction '{id}' more than once"
                )
            }
            ContentError::ZeroDuration {
                object,
                interaction,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' has duration_ticks of 0; must be at least 1"
            ),
            ContentError::ZeroSlots {
                object,
                interaction,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' has slots of 0; must be at least 1"
            ),
            ContentError::NonFiniteValue { context } => {
                write!(f, "{context} is not a finite number")
            }
            ContentError::NegativeValue { context } => {
                write!(f, "{context} is negative")
            }
        }
    }
}

impl std::error::Error for ContentError {}
