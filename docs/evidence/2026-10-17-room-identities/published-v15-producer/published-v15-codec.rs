use std::io::{Read, Write};
pub use terri_core::SaveSnapshotV14;
#[path = "D:/VIBES/.worktrees/f19a/terrilives/.local-build/p15-a481/crates/terri-core/src/save_v15.rs"]
mod published_v15;
use published_v15::{SaveSnapshotV15, SavedConversationOrigin, SavedConversationPhase};

fn quoted(value: &str) -> String {
    let mut result = String::from("\"");
    for c in value.chars() {
        match c {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            c if (c as u32) < 32 => result.push_str(&format!("\\u{:04x}", c as u32)),
            c => result.push(c),
        }
    }
    result.push('"');
    result
}
fn optional_text(value: Option<&str>) -> String {
    value.map(quoted).unwrap_or_else(|| "null".into())
}
fn optional_number(value: Option<u32>) -> String {
    value.map(|n| n.to_string()).unwrap_or_else(|| "null".into())
}
fn inspect(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 10 || &bytes[..8] != b"TERRISAV"
        || u16::from_le_bytes([bytes[8], bytes[9]]) != 15 {
        return Err("Expected published V15 header".into());
    }
    let (s, tail) = postcard::take_from_bytes::<SaveSnapshotV15>(&bytes[10..])
        .map_err(|e| format!("Published V15 decoding failed: {e}"))?;
    if !tail.is_empty() { return Err("Trailing published payload".into()); }
    if postcard::to_allocvec(&s).map_err(|e| e.to_string())? != bytes[10..] {
        return Err("Published DTO roundtrip changed payload bytes".into());
    }
    let v14 = &s.legacy;
    let v13 = &v14.legacy;
    let v12 = &v13.legacy;
    let v11 = &v12.legacy;
    let v10 = &v11.legacy;
    let v6 = &v10.legacy;
    let world = &v6.legacy.world;
    let requests: Vec<String> = s.conversation_requests.requests.iter().map(|r| {
        let phase = match r.phase {
            SavedConversationPhase::Approaching => "approaching",
            SavedConversationPhase::Waiting => "waiting",
            SavedConversationPhase::Suspended => "suspended",
            SavedConversationPhase::Talking => "talking",
        };
        let origin = match r.origin {
            SavedConversationOrigin::Autonomous => "{\"kind\":\"autonomous\"}".into(),
            SavedConversationOrigin::LegacyUnattributed => "{\"kind\":\"legacy\"}".into(),
            SavedConversationOrigin::Player { order_id } => format!("{{\"kind\":\"player\",\"order_id\":\"{order_id}\"}}"),
        };
        let waiting = r.waiting_tile.map(|(x,y)| format!("[{x},{y}]"))
            .unwrap_or_else(|| "null".into());
        format!("{{\"id\":\"{}\",\"initiator\":{},\"recipient\":{},\"interaction\":{},\"origin\":{},\"created\":\"{}\",\"phase\":{},\"waiting_tile\":{},\"target_owned\":{}}}",
            r.id, r.initiator, r.recipient, quoted(&r.interaction), origin, r.created,
            quoted(phase), waiting, r.target_owned)
    }).collect();
    let entities: Vec<String> = world.entities.iter().map(|e| {
        let position = e.position.map(|p| format!("[{},{}]", p.x, p.y)).unwrap_or_else(|| "null".into());
        let target = e.target.map(|t| format!("{{\"object\":{},\"interaction\":{}}}",t.object,t.interaction)).unwrap_or_else(|| "null".into());
        let path = e.path.as_ref().map(|p| {
            let steps: Vec<_> = p.steps.iter().map(|(x,y)| format!("[{x},{y}]")).collect();
            format!("{{\"cursor\":{},\"steps\":[{}]}}",p.cursor,steps.join(","))
        }).unwrap_or_else(|| "null".into());
        let eating = e.eating.as_ref().map(|a| format!("{{\"model\":{},\"interaction\":{},\"remaining\":{}}}",quoted(&a.object),a.interaction,a.remaining_ticks)).unwrap_or_else(|| "null".into());
        let social = e.socialising.map(|a| format!("{{\"partner\":{},\"interaction\":{},\"remaining\":{}}}",a.partner,a.interaction,a.remaining_ticks)).unwrap_or_else(|| "null".into());
        let needs = e.needs.as_ref().map(|n| format!("[{}]",n.iter().map(|n|n.to_string()).collect::<Vec<_>>().join(","))).unwrap_or_else(|| "null".into());
        format!("{{\"index\":{},\"sim_id\":{},\"name\":{},\"agent\":{},\"model\":{},\"position\":{},\"target\":{},\"path\":{},\"reserved\":{},\"blocked\":{},\"eating\":{},\"social\":{},\"needs\":{},\"voice\":{}}}",
            e.index, optional_number(e.sim_id), optional_text(e.sim_name.as_deref()),e.agent,
            optional_text(e.smart_object.as_deref()),position,target,path,e.reserved,e.blocked,
            eating,social,needs,quoted(&format!("{:?}",e.conversation_voice)))
    }).collect();
    let queues: Vec<_> = v6.queues.iter().map(|q| {
        let orders: Vec<_> = q.orders.iter().map(|o| format!("{{\"id\":\"{}\",\"target\":{},\"action\":{},\"title\":{}}}",o.id,o.target,quoted(&o.action),optional_text(o.title.as_deref()))).collect();
        format!("{{\"owner\":{},\"next_id\":\"{}\",\"orders\":[{}]}}",q.owner,q.next_id,orders.join(","))
    }).collect();
    let social_actions: Vec<_> = v6.actions.social.iter().map(|a|quoted(a)).collect();
    let rendezvous: Vec<_> = v10.social.rendezvous.iter().map(|(a,b)|format!("[{a},{b}]")).collect();
    let queued: Vec<_> = world.queued_commands.iter().map(|c| {
        let bytes = postcard::to_allocvec(c).expect("Saved command encodes");
        format!("{{\"debug\":{},\"hex\":{}}}",quoted(&format!("{c:?}")),quoted(&bytes.iter().map(|b|format!("{b:02x}")).collect::<String>()))
    }).collect();
    Ok(format!("{{\"schema\":15,\"tick\":\"{}\",\"width\":{},\"height\":{},\"next_request_id\":\"{}\",\"requests\":[{}],\"entities\":[{}],\"queues\":[{}],\"social_actions\":[{}],\"rendezvous\":[{}],\"queued\":[{}],\"command_order_v6\":{},\"command_order_v10\":{}}}",
        world.tick,world.grid_width,world.grid_height,s.conversation_requests.next_id,
        requests.join(","),entities.join(","),queues.join(","),social_actions.join(","),
        rendezvous.join(","),queued.join(","),quoted(&format!("{:?}",v6.command_order)),quoted(&format!("{:?}",v10.command_order))))
}
fn number(args: &[String], index: usize) -> u32 {
    args.get(index).expect("Missing command index").parse().expect("Invalid u32 index")
}
fn main() {
    fn traits<T: serde::Serialize + serde::de::DeserializeOwned>() {}
    traits::<SaveSnapshotV15>();
    let args: Vec<String> = std::env::args().collect();
    let operation = args.get(1).expect("Use inspect, talk, front, use, use-front or cancel");
    if operation == "inspect" {
        let mut bytes = Vec::new();
        std::io::stdin().read_to_end(&mut bytes).unwrap();
        match inspect(&bytes) {
            Ok(json) => println!("{json}"),
            Err(error) => { eprintln!("{error}"); std::process::exit(1); }
        }
    } else {
        let agent = number(&args,2);
        let command = match operation.as_str() {
            "talk" => terri_core::SimCommand::TalkTo { agent, target:number(&args,3), interaction:number(&args,4) },
            "front" => terri_core::SimCommand::TalkToFirst { agent, target:number(&args,3), interaction:number(&args,4) },
            "use" => terri_core::SimCommand::UseObject { agent, object:number(&args,3), interaction:number(&args,4) },
            "use-front" => terri_core::SimCommand::UseObjectFirst { agent, object:number(&args,3), interaction:number(&args,4) },
            "cancel" => terri_core::SimCommand::CancelIntents { agent },
            _ => panic!("Unknown operation"),
        };
        std::io::stdout().write_all(&postcard::to_allocvec(&command).unwrap()).unwrap();
    }
}
