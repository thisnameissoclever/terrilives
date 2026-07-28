//! Deterministic hashing for the world-state determinism test.
//!
//! FNV-1a is used rather than the standard library hasher because
//! DefaultHasher is explicitly not guaranteed stable across releases,
//! and this hash must be comparable over time.

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

// Sentinels for non-finite input. Each is unreachable by the quantizer
// in `write_f32`: saturation can only ever land on i64::MAX or i64::MIN
// exactly, and a finite product that rounds into this magnitude is an
// f32, whose spacing there is 2^39, so only multiples of 2^39 are
// representable. None of the three is one.
const NON_FINITE_NAN: i64 = i64::MIN + 1;
const NON_FINITE_POS_INF: i64 = i64::MIN + 2;
const NON_FINITE_NEG_INF: i64 = i64::MIN + 3;

#[derive(Debug, Clone, Copy)]
pub struct FnvHasher(u64);

impl Default for FnvHasher {
    fn default() -> Self {
        Self(FNV_OFFSET)
    }
}

impl FnvHasher {
    pub fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= *byte as u64;
            self.0 = self.0.wrapping_mul(FNV_PRIME);
        }
    }

    pub fn write_u64(&mut self, value: u64) {
        self.write_bytes(&value.to_le_bytes());
    }

    /// Floats are quantized to 1e-4 tiles before hashing, which is far
    /// below one rendered pixel, so most last-bit rounding artefacts fall
    /// inside a bucket and hash the same.
    ///
    /// That is a tendency, not a guarantee. Rounding relocates the cliff
    /// rather than removing it: two values 1.19e-7 apart still produce
    /// different digests when they straddle a bucket boundary. The
    /// property this buys is one-directional - a *visible* difference is
    /// always caught - and it must not be read as "sub-threshold noise is
    /// never reported".
    ///
    /// Non-finite input bypasses the quantizer entirely.
    /// `(f32::NAN * 10_000.0).round() as i64` is `0` under Rust's
    /// saturating float-to-int cast, so without this branch a run whose
    /// position went NaN would hash identically to one holding 0.0,
    /// silently masking exactly the float divergence this hash exists to
    /// catch. The infinities saturate to `i64::MAX` / `i64::MIN` and would
    /// collide with any finite value past roughly 9.2e14.
    pub fn write_f32(&mut self, value: f32) {
        if !value.is_finite() {
            let sentinel = if value.is_nan() {
                NON_FINITE_NAN
            } else if value.is_sign_positive() {
                NON_FINITE_POS_INF
            } else {
                NON_FINITE_NEG_INF
            };
            self.write_bytes(&sentinel.to_le_bytes());
            return;
        }
        let quantized = (value * 10_000.0).round() as i64;
        self.write_bytes(&quantized.to_le_bytes());
    }

    pub fn finish(&self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector_pins_the_fnv1a_constants() {
        // The canonical FNV-1a 64-bit digest of b"terrilives". A golden
        // value, not a self-comparison: it fails if the offset basis, the
        // prime, or the byte order ever drifts, which a
        // hash-equals-itself test could never see. Recomputed by hand:
        // h = FNV_OFFSET; for b in bytes { h ^= b; h *= FNV_PRIME }.
        let mut hasher = FnvHasher::default();
        hasher.write_bytes(b"terrilives");
        assert_eq!(hasher.finish(), 0x50ff_a642_4fda_accc);
    }

    #[test]
    fn empty_input_is_the_offset_basis() {
        assert_eq!(FnvHasher::default().finish(), FNV_OFFSET);
    }

    #[test]
    fn quantization_absorbs_sub_threshold_float_noise() {
        // A specific sub-threshold difference that lands inside one
        // bucket. This pins the quantizer's existence, not a general
        // property: see write_f32 on why a sub-threshold difference
        // straddling a bucket boundary still changes the digest.
        let mut a = FnvHasher::default();
        a.write_f32(3.5);
        let mut b = FnvHasher::default();
        b.write_f32(3.5 + 1e-6);
        assert_eq!(a.finish(), b.finish());
    }

    #[test]
    fn quantization_still_catches_a_visible_difference() {
        // The other half of the property above: the tolerance must not be
        // so wide that real movement disappears. Without this, widening
        // the quantizer to uselessness would leave the suite green.
        let mut a = FnvHasher::default();
        a.write_f32(3.5);
        let mut b = FnvHasher::default();
        b.write_f32(3.5010);
        assert_ne!(a.finish(), b.finish());
    }

    #[test]
    fn non_finite_values_get_distinct_digests() {
        fn digest(value: f32) -> u64 {
            let mut hasher = FnvHasher::default();
            hasher.write_f32(value);
            hasher.finish()
        }

        // The quantizer alone maps NaN to 0, so a position that went NaN
        // would hash exactly like one holding 0.0 - the hash would hide
        // the divergence it exists to report. The infinities saturate to
        // i64::MAX / i64::MIN, which every sufficiently large finite
        // value also saturates to.
        let nan = digest(f32::NAN);
        let pos_inf = digest(f32::INFINITY);
        let neg_inf = digest(f32::NEG_INFINITY);

        assert_ne!(nan, digest(0.0), "NaN collides with 0.0");
        assert_ne!(nan, pos_inf, "NaN collides with +inf");
        assert_ne!(nan, neg_inf, "NaN collides with -inf");
        assert_ne!(pos_inf, neg_inf, "+inf collides with -inf");

        // Every sentinel must clear BOTH saturation points, not just the
        // one on its own side. This is the whole reason the three are
        // `i64::MIN + 1..3` rather than `i64::MIN` and `i64::MAX`
        // themselves, and the earlier version of this test checked only
        // the matching side: it asserted +inf differs from a huge
        // positive and -inf from a huge negative, and said nothing about
        // the four remaining pairings.
        //
        // Measured consequence of the gap: `i64::MIN + 1` mutated to
        // `i64::MIN * 1` compiles, leaves the sentinel AT i64::MIN, and
        // makes NaN hash identically to any coordinate below roughly
        // -9.2e14. That mutant survived the whole suite.
        for (label, sentinel) in [("NaN", nan), ("+inf", pos_inf), ("-inf", neg_inf)] {
            assert_ne!(
                sentinel,
                digest(1.0e30),
                "{label} collides with i64::MAX saturation"
            );
            assert_ne!(
                sentinel,
                digest(-1.0e30),
                "{label} collides with i64::MIN saturation"
            );
        }
    }

    #[test]
    fn write_order_changes_the_digest() {
        // Pins that the hash is order-sensitive over its input sequence,
        // which is exactly why world_hash must sort its rows first.
        let mut a = FnvHasher::default();
        a.write_u64(1);
        a.write_u64(2);
        let mut b = FnvHasher::default();
        b.write_u64(2);
        b.write_u64(1);
        assert_ne!(a.finish(), b.finish());
    }
}
