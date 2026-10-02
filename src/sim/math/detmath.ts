/**
 * Deterministic math (ARCHITECTURE.md §5.4).
 *
 * The JS spec lets engines implement Math.pow/exp/log/sin/... with slightly different
 * results in the last bit, which would desynchronize multiplayer games. These versions
 * use only + − × ÷ (exactly specified by IEEE 754, and JS forbids fusing them) with a
 * fixed number of steps, so every engine computes bit-identical results. They are
 * accurate to ~1e-15 relative error, far more than gameplay needs.
 */

const LN2 = 0.6931471805599453;
const LN2_HIGH = 0.6931471803691238; // ln2 rounded to 32 significant bits
const LN2_LOW = 1.9082149292705877e-10; // ln2 − LN2_HIGH
const SQRT2 = 1.4142135623730951;

/** Natural logarithm. Returns -Infinity for 0 and NaN for negative input. */
export function detLog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;

  // x = m · 2^e with m in [√½, √2]. Multiplying/dividing by 2 is exact.
  let m = x;
  let e = 0;
  while (m >= 2) {
    m /= 2;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  if (m > SQRT2) {
    m /= 2;
    e++;
  }

  // ln(m) = 2·atanh(s) = 2·(s + s³/3 + s⁵/5 + …) with s = (m−1)/(m+1), |s| ≤ 0.172.
  // 12 terms reach full double precision for that range.
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let k = 3; k <= 25; k += 2) {
    term *= s2;
    sum += term / k;
  }
  return e * LN2 + 2 * sum;
}

/** e^x. */
export function detExp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.2) return 0;

  // x = k·ln2 + r with |r| ≤ ln2/2, so e^x = 2^k · e^r. ln2 is split into a high part
  // with trailing zero bits (so k·LN2_HIGH is exact) and a tiny correction, which keeps
  // r accurate even for large k.
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HIGH - k * LN2_LOW;

  // Taylor series of e^r; 18 terms reach full double precision for |r| ≤ 0.35.
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 18; n++) {
    term = (term * r) / n;
    sum += term;
  }
  return sum * powerOfTwo(k);
}

/** base^exponent for base ≥ 0. */
export function detPow(base: number, exponent: number): number {
  if (exponent === 0) return 1;
  if (base === 0) return exponent > 0 ? 0 : Infinity;
  if (base < 0) return NaN;
  if (base === 1) return 1;
  return detExp(exponent * detLog(base));
}

/** 2^k for integer k, built by exact doubling/halving. */
function powerOfTwo(k: number): number {
  let result = 1;
  if (k >= 0) {
    for (let i = 0; i < k; i++) result *= 2;
  } else {
    for (let i = 0; i > k; i--) result /= 2;
  }
  return result;
}
