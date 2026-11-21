//! The admin command at the ordinary queue (issue 312, [AP-cmd-admit] and
//! [AP-save-queue] item 2 in `docs/specs/2026-11-20-admin-panel.md`): the
//! ordinary entry point refuses admin bytes outright, so no path but the
//! admin panel's own export can queue one.
use super::*;
use terri_core::admin::{AdminChange, AdminEdit};

#[test]
fn enqueue_command_refuses_admin_bytes_and_leaves_the_queue_alone() {
    let mut handle = SimHandle::from_lot();
    assert!(handle.enqueue_command(&postcard::to_allocvec(&SimCommand::Select(None)).unwrap()));
    let before = handle
        .sim
        .world()
        .resource::<CommandQueue>()
        .as_slice()
        .to_vec();
    let hash = handle.sim.world_hash();
    let bytes = postcard::to_allocvec(&SimCommand::Admin(Box::new(AdminChange {
        edits: vec![AdminEdit::SetFunds { cents: 100 }],
    })))
    .unwrap();
    assert_eq!(bytes[0], 41);
    assert!(!handle.enqueue_command(&bytes));
    assert_eq!(
        handle.sim.world().resource::<CommandQueue>().as_slice(),
        before.as_slice()
    );
    assert_eq!(handle.sim.world_hash(), hash);
}
