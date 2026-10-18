use super::SimCommand;

#[test]
fn confirmed_work_order_appends_without_renumbering_existing_commands() {
    // Code 35, fingerprint 7, use-object order 0, person 2, object 3,
    // action 4, back placement 0.
    let bytes = [35, 7, 0, 2, 3, 4, 0];
    let decoded = postcard::from_bytes::<SimCommand>(&bytes);
    assert!(
        decoded.is_ok(),
        "a confirmed work order must decode: {decoded:?}"
    );
    assert_eq!(postcard::to_allocvec(&decoded.unwrap()).unwrap(), bytes);
}
