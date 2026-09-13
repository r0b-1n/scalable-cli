//! Deterministic, dependency-free PRNG for the mock backend.
//!
//! Determinism is a hard requirement of this crate: the same seed (and, via [`Rng::for_key`],
//! the same `(seed, key)` pair) must always produce the same sequence of values, regardless of
//! process, platform, or call order elsewhere in the program. This module intentionally avoids
//! the `rand` crate so the generation algorithm is fully under our control and can never change
//! silently underneath us on a dependency bump.
//!
//! Algorithm: a `u64` seed is expanded into four `u64` state words via SplitMix64 (a simple,
//! well-known seed-expansion step), then consumed by the xoshiro256** generator for the actual
//! output stream. Both are tiny, public-domain-style algorithms with no external crates.


/// A small, fast, deterministic PRNG (xoshiro256**, seeded via SplitMix64).
///
/// Cloning an `Rng` forks its stream (the clone continues independently from that point) —
/// useful for peeking ahead without disturbing the original.
#[derive(Clone, Debug)]
pub struct Rng {
    state: [u64; 4],
}

impl Rng {
    /// Create a generator seeded directly from a `u64`. Same seed => same sequence, always.
    pub fn seeded(seed: u64) -> Self {
        let mut sm = SplitMix64::new(seed);
        // xoshiro256** is defined for any state that isn't all-zero; SplitMix64 output is
        // vanishingly unlikely to produce four zeros in a row for any seed.
        Rng {
            state: [sm.next(), sm.next(), sm.next(), sm.next()],
        }
    }

    /// Create a generator for a stable per-key stream. `key` is hashed (FNV-1a) and folded into
    /// `seed`, so `Rng::for_key(seed, "US0378331005")` always yields the same sequence no matter
    /// what else has been drawn from `seed` elsewhere, or in what order different keys are
    /// requested — each call builds a fresh, independent generator from scratch.
    pub fn for_key(seed: u64, key: &str) -> Self {
        let hashed = fnv1a(key.as_bytes());
        // Fold with the same odd constant SplitMix64 uses for its increment so that keys
        // differing by one bit still land far apart in state space.
        Rng::seeded(seed ^ hashed.wrapping_add(0x9E37_79B9_7F4A_7C15))
    }

    /// Next raw 64-bit output (xoshiro256** core step).
    pub fn next_u64(&mut self) -> u64 {
        let result = rotl(self.state[1].wrapping_mul(5), 7).wrapping_mul(9);
        let t = self.state[1] << 17;

        self.state[2] ^= self.state[0];
        self.state[3] ^= self.state[1];
        self.state[1] ^= self.state[2];
        self.state[0] ^= self.state[3];
        self.state[2] ^= t;
        self.state[3] = rotl(self.state[3], 45);

        result
    }

    /// Uniform float in `[0, 1)`, using the top 53 bits of a raw draw (the standard
    /// double-from-u64 trick, giving full `f64` mantissa precision).
    pub fn next_f64(&mut self) -> f64 {
        const SCALE: f64 = 1.0 / (1u64 << 53) as f64;
        (self.next_u64() >> 11) as f64 * SCALE
    }

    /// Uniform float in `[lo, hi)`.
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.next_f64() * (hi - lo)
    }

    /// Uniform integer in `[lo, hi]` (inclusive on both ends).
    pub fn range_i64(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        let span = (hi - lo + 1) as u64;
        lo + (self.next_u64() % span) as i64
    }

    /// Standard normal draw (mean 0, variance 1) via the Box-Muller transform.
    pub fn normal(&mut self) -> f64 {
        // Avoid u1 == 0.0, which would make ln(u1) undefined.
        let u1 = self.next_f64().max(f64::MIN_POSITIVE);
        let u2 = self.next_f64();
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }

    /// Pick a uniformly random element from a non-empty slice. Not currently called by any
    /// handler (generators so far index/compute directly), kept as part of `Rng`'s public surface.
    #[allow(dead_code)]
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        assert!(!items.is_empty(), "Rng::pick called with an empty slice");
        let idx = self.range_i64(0, items.len() as i64 - 1) as usize;
        &items[idx]
    }

    /// `true` with probability `p` (clamped to `[0, 1]`).
    pub fn chance(&mut self, p: f64) -> bool {
        self.next_f64() < p.clamp(0.0, 1.0)
    }
}

fn rotl(x: u64, k: u32) -> u64 {
    x.rotate_left(k)
}

/// SplitMix64 — used only to expand a single `u64` seed into well-distributed initial state.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }

    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// FNV-1a 64-bit hash — stable, dependency-free string hashing for [`Rng::for_key`].
fn fnv1a(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::seeded(42);
        let mut b = Rng::seeded(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = Rng::seeded(1);
        let mut b = Rng::seeded(2);
        let seq_a: Vec<u64> = (0..16).map(|_| a.next_u64()).collect();
        let seq_b: Vec<u64> = (0..16).map(|_| b.next_u64()).collect();
        assert_ne!(seq_a, seq_b);
    }

    #[test]
    fn for_key_is_order_independent() {
        // Draw a reference sequence for "AAPL" first...
        let mut reference = Rng::for_key(7, "AAPL");
        let reference_seq: Vec<u64> = (0..32).map(|_| reference.next_u64()).collect();

        // ...then again, but only after other keys have been drawn from in between, and in a
        // different order. The "AAPL" stream must come out identically either way, since each
        // for_key() call constructs an independent generator with no shared mutable state.
        let mut warmup1 = Rng::for_key(7, "MSFT");
        let _ = (0..50).map(|_| warmup1.next_u64()).count();
        let mut warmup2 = Rng::for_key(7, "TSLA");
        let _ = (0..5).map(|_| warmup2.next_u64()).count();

        let mut again = Rng::for_key(7, "AAPL");
        let again_seq: Vec<u64> = (0..32).map(|_| again.next_u64()).collect();

        assert_eq!(reference_seq, again_seq);
    }

    #[test]
    fn for_key_differs_by_key() {
        let mut a = Rng::for_key(7, "AAPL");
        let mut b = Rng::for_key(7, "MSFT");
        let seq_a: Vec<u64> = (0..16).map(|_| a.next_u64()).collect();
        let seq_b: Vec<u64> = (0..16).map(|_| b.next_u64()).collect();
        assert_ne!(seq_a, seq_b);
    }

    #[test]
    fn next_f64_in_unit_range() {
        let mut r = Rng::seeded(123);
        for _ in 0..10_000 {
            let v = r.next_f64();
            assert!((0.0..1.0).contains(&v), "next_f64 produced {v}, expected [0,1)");
        }
    }

    #[test]
    fn range_respects_bounds() {
        let mut r = Rng::seeded(9);
        for _ in 0..10_000 {
            let v = r.range(-5.0, 5.0);
            assert!((-5.0..5.0).contains(&v));
        }
    }

    #[test]
    fn range_i64_respects_inclusive_bounds() {
        let mut r = Rng::seeded(2024);
        let mut saw_lo = false;
        let mut saw_hi = false;
        for _ in 0..10_000 {
            let v = r.range_i64(1, 3);
            assert!((1..=3).contains(&v));
            saw_lo |= v == 1;
            saw_hi |= v == 3;
        }
        assert!(saw_lo && saw_hi, "range_i64 should eventually hit both endpoints");
    }

    #[test]
    fn normal_has_roughly_zero_mean_and_unit_variance() {
        let mut r = Rng::seeded(555);
        const N: usize = 200_000;
        let mut sum = 0.0_f64;
        let mut sum_sq = 0.0_f64;
        for _ in 0..N {
            let z = r.normal();
            sum += z;
            sum_sq += z * z;
        }
        let mean = sum / N as f64;
        let variance = sum_sq / N as f64 - mean * mean;
        assert!(mean.abs() < 0.02, "mean {mean} too far from 0");
        assert!((variance - 1.0).abs() < 0.05, "variance {variance} too far from 1");
    }

    #[test]
    fn pick_only_returns_items_from_slice() {
        let mut r = Rng::seeded(77);
        let items = ["a", "b", "c", "d"];
        for _ in 0..1000 {
            let picked = r.pick(&items);
            assert!(items.contains(picked));
        }
    }

    #[test]
    fn chance_respects_extremes() {
        let mut r = Rng::seeded(3);
        for _ in 0..100 {
            assert!(!r.chance(0.0));
        }
        for _ in 0..100 {
            assert!(r.chance(1.0));
        }
    }
}
