//! Pure simulation core. No web dependencies, ever.

/// Trivial value used only to prove the Rust -> WASM -> JS path works.
/// Deleted once real state crosses the boundary.
pub fn smoke_value() -> u32 {
    42
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_value_is_42() {
        assert_eq!(smoke_value(), 42);
    }
}
