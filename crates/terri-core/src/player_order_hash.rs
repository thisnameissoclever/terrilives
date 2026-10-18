//! Exact command identity for saved work confirmations.
use crate::{command::PlayerOrder, FnvHasher};

fn text(hash: &mut FnvHasher, value: &str) {
    hash.write_u64(value.len() as u64);
    hash.write_bytes(value.as_bytes());
}

pub fn command(order: &PlayerOrder) -> u64 {
    let mut hash = FnvHasher::default();
    match order {
        PlayerOrder::UseObject {
            agent,
            object,
            interaction,
            front,
        }
        | PlayerOrder::TalkTo {
            agent,
            target: object,
            interaction,
            front,
        } => {
            hash.write_u64(u64::from(matches!(order, PlayerOrder::TalkTo { .. })));
            for value in [*agent, *object, *interaction] {
                hash.write_u64(u64::from(value));
            }
            hash.write_u64(u64::from(*front));
        }
        PlayerOrder::ReadBook {
            agent,
            object,
            action,
            title,
            front,
        } => {
            hash.write_u64(2);
            hash.write_u64(u64::from(*agent));
            hash.write_u64(u64::from(*object));
            text(&mut hash, action);
            text(&mut hash, title);
            hash.write_u64(u64::from(*front));
        }
        PlayerOrder::CleanChore { agent, key, front } => {
            hash.write_u64(3);
            for value in [*agent, key.kind as u32, key.target] {
                hash.write_u64(u64::from(value));
            }
            hash.write_u64(u64::from(*front));
        }
        PlayerOrder::CleanDishes {
            agent,
            surface,
            dishes,
            front,
        } => {
            hash.write_u64(4);
            hash.write_u64(u64::from(*agent));
            hash.write_u64(u64::from(*surface));
            hash.write_u64(u64::from(dishes.is_some()));
            if let Some(dishes) = dishes {
                hash.write_u64(dishes.len() as u64);
                for dish in dishes {
                    hash.write_u64(u64::from(*dish));
                }
            }
            hash.write_u64(u64::from(*front));
        }
    }
    hash.finish()
}
