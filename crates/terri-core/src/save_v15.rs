//! Conversation commitments extend the frozen schema-fourteen envelope.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedConversationOrigin {
    Autonomous,
    Player { order_id: u64 },
    LegacyUnattributed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedConversationPhase {
    Approaching,
    Waiting,
    Suspended,
    Talking,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedConversationRequest {
    pub id: u64,
    pub initiator: u32,
    pub recipient: u32,
    pub interaction: String,
    pub origin: SavedConversationOrigin,
    pub created: u64,
    pub phase: SavedConversationPhase,
    pub waiting_tile: Option<(i32, i32)>,
    /// Waiting targets are carried here because historical validators require reserved recipients.
    pub target_owned: bool,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedConversationRequests {
    pub next_id: u64,
    pub requests: Vec<SavedConversationRequest>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV15 {
    pub legacy: crate::SaveSnapshotV14,
    pub conversation_requests: SavedConversationRequests,
}
