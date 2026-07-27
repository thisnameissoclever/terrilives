//! Deterministic hashing for the world-state determinism test.
//!
//! FNV-1a is used rather than the standard library hasher because
//! DefaultHasher is explicitly not guaranteed stable across releases,
//! and this hash must be comparable over time.

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

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

    /// Floats are quantized before hashing. Two runs that differ only by
    /// a last-bit rounding artefact should not be reported as divergent,
    /// but anything visible must be caught. 1e-4 tiles is far below one
    /// rendered pixel.
    pub fn write_f32(&mut self, value: f32) {
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
        // Differences below 1e-4 tiles are rounding artefacts and must
        // not read as divergence.
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
