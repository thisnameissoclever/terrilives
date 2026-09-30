//! Decode only the published pre-voice V1 shape, then use normal world validation.

use terri_core::{SaveSnapshotV1, SaveSnapshotV1BeforeVoice};

pub(super) fn decode(payload: &[u8]) -> Option<SaveSnapshotV1> {
    let (fingerprint, _) = postcard::take_from_bytes::<u64>(payload).ok()?;
    // Four original full-pack digests and the pre-aquarium structural digest.
    // These releases predate the per-entity conversation_voice field.
    // A newer or unknown digest must never reinterpret a damaged current row.
    if !matches!(
        fingerprint,
        0x9d22_8822_6933_d3c7
            | 0x263e_ed3b_bdcb_a7d0
            | 0x08ec_6011_bc11_7ad8
            | 0x2eb2_02fa_e70e_4939
            | 0x26d5_982c_9af8_3de8
    ) {
        return None;
    }
    match postcard::take_from_bytes::<SaveSnapshotV1BeforeVoice>(payload) {
        Ok((snapshot, [])) => Some(snapshot.into_current()),
        // The earliest V1 also predates the single appended sleep-pressure list.
        // Pad only that absent empty tail, never a malformed option or a list body.
        Err(postcard::Error::DeserializeUnexpectedEnd) => {
            let mut padded = payload.to_vec();
            padded.push(0);
            match postcard::take_from_bytes::<SaveSnapshotV1BeforeVoice>(&padded) {
                Ok((snapshot, [])) if snapshot.sleep_pressure.is_empty() => {
                    Some(snapshot.into_current())
                }
                _ => None,
            }
        }
        _ => None,
    }
}
