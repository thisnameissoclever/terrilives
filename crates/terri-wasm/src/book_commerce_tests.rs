use super::*;
use terri_core::books::{BookPurchaseQuote, BookSaleQuote};

#[test]
fn quotes_round_trip_pending_commands_and_old_headers_refuse_new_tags() {
    let mut handle = SimHandle::from_lot();
    assert_eq!(handle.sim.book_copies().len(), 3);
    assert_eq!(
        handle
            .sim
            .book_copies()
            .iter()
            .map(|copy| &copy.title_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        3
    );
    handle
        .sim
        .world_mut()
        .insert_resource(terri_core::Funds(100));
    let before = handle.save_bytes();
    let quote = handle.book_purchase_quote();
    let (_, result): (u8, Result<BookPurchaseQuote, String>) =
        postcard::from_bytes(&quote).unwrap();
    let purchase = result.unwrap();
    assert_eq!(handle.book_purchase_quote(), quote);
    assert_eq!(handle.save_bytes(), before);
    assert!(handle.buy_automatic_book(&quote));
    let pending = handle.save_bytes();
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&pending));
    assert_eq!(restored.save_bytes(), pending);
    for version in [6u16, 7] {
        let mut old = pending.clone();
        old[8..10].copy_from_slice(&version.to_le_bytes());
        let unchanged = restored.save_bytes();
        assert!(!restored.load_bytes(&old));
        assert_eq!(restored.save_bytes(), unchanged);
    }
    let count = handle.sim.book_copies().len();
    handle.sim.flush_commands();
    restored.sim.flush_commands();
    assert_eq!(handle.sim.book_copies().len(), count + 1);
    assert_eq!(handle.save_bytes(), restored.save_bytes());
    let sale = handle.book_sale_quote(purchase.home.shelf.0 as f64);
    let (_, result): (u8, Result<BookSaleQuote, String>) = postcard::from_bytes(&sale).unwrap();
    assert!(result.is_ok());
    assert!(handle.sell_book(&sale));
    handle.sim.flush_commands();
    assert_eq!(handle.sim.book_copies().len(), count);
}

#[test]
fn historical_v6_without_affinities_keeps_its_dropped_copy_and_can_recover() {
    let mut handle = SimHandle::from_lot();
    let old = include_bytes!("../../../web/tests/fixtures/owned-reading-dropped.sav");
    assert!(handle.load_bytes(old));
    let copy = handle
        .sim
        .book_copies()
        .iter()
        .find(|copy| matches!(copy.location, terri_core::books::BookLocation::Lot { .. }))
        .unwrap()
        .id
        .0;
    let current = handle.save_bytes();
    assert!(handle.load_bytes(&current));
    assert_eq!(handle.save_bytes(), current);
    assert!(handle.recover_book(f64::from(copy)));
    handle.sim.flush_commands();
    assert!(matches!(
        handle
            .sim
            .book_copies()
            .iter()
            .find(|book| book.id.0 == copy)
            .unwrap()
            .location,
        terri_core::books::BookLocation::Shelf(_)
    ));
}

#[test]
fn staging_rejects_inflated_prices_and_incomplete_envelopes() {
    let mut handle = SimHandle::from_lot();
    let bytes = handle.book_purchase_quote();
    let (_, result): (u8, Result<BookPurchaseQuote, String>) =
        postcard::from_bytes(&bytes).unwrap();
    let mut quote = result.unwrap();
    quote.price += 1;
    let raw = postcard::to_allocvec(&SimCommand::Book(
        terri_core::command::BookCommand::AutoPurchase {
            quote: quote.clone(),
        },
    ))
    .unwrap();
    assert!(
        !handle.enqueue_command(&raw),
        "raw new commerce must use the same ingress validation"
    );
    let forged = postcard::to_allocvec(&(1u8, Ok::<_, String>(quote))).unwrap();
    let before = handle.save_bytes();
    assert!(!handle.buy_automatic_book(&forged));
    for cut in 0..bytes.len() {
        assert!(!handle.buy_automatic_book(&bytes[..cut]));
    }
    assert_eq!(handle.save_bytes(), before);
}
