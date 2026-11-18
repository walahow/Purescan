/**
 * Shared monotonic compression curve & bounded binary-search solver
 * used by both Phase A (Scan-to-PDF export) and Phase B (Existing PDF compressor).
 */

export interface EncodingParams {
  /** Scalar compression level in [0..100] (0 = smallest, 100 = highest quality) */
  level: number;
  maxDim: number;
  jpegQuality: number;
}

interface LadderStop {
  level: number;
  maxDim: number;
  jpegQuality: number;
}

/**
 * Piecewise-linear monotonic ladder mapping a 0..100 scalar to (maxDim, jpegQuality).
 * Designed so every step up strictly increases visual quality and expected byte size,
 * keeping binary search predictable and preventing blurry-yet-large configurations.
 */
const LADDER_STOPS: readonly LadderStop[] = [
  { level: 0, maxDim: 780, jpegQuality: 0.38 },
  { level: 20, maxDim: 1050, jpegQuality: 0.50 },
  { level: 45, maxDim: 1400, jpegQuality: 0.64 },
  { level: 70, maxDim: 1800, jpegQuality: 0.76 },
  { level: 100, maxDim: 2200, jpegQuality: 0.88 },
];

export function levelToEncodingParams(rawLevel: number): EncodingParams {
  const level = Math.max(0, Math.min(100, rawLevel));

  for (let i = 0; i < LADDER_STOPS.length - 1; i++) {
    const a = LADDER_STOPS[i];
    const b = LADDER_STOPS[i + 1];
    if (level <= b.level) {
      const t = (level - a.level) / (b.level - a.level);
      const maxDim = Math.round(a.maxDim + (b.maxDim - a.maxDim) * t);
      const jpegQuality = Math.round((a.jpegQuality + (b.jpegQuality - a.jpegQuality) * t) * 100) / 100;
      return { level: Math.round(level), maxDim, jpegQuality };
    }
  }

  const last = LADDER_STOPS[LADDER_STOPS.length - 1];
  return { level: 100, maxDim: last.maxDim, jpegQuality: last.jpegQuality };
}

/**
 * Picks up to 3 representative indices (heaviest, median, lightest by byte weight)
 * so multi-page/multi-image probes estimate total byte size in O(1) time.
 */
export function selectRepresentativeIndices(weights: number[], maxSamples = 3): {
  indices: number[];
  scaleFactor: number;
} {
  if (weights.length === 0) {
    return { indices: [], scaleFactor: 1 };
  }
  if (weights.length <= maxSamples) {
    return {
      indices: weights.map((_, i) => i),
      scaleFactor: 1,
    };
  }

  const sorted = weights
    .map((weight, idx) => ({ idx, weight: Math.max(1, weight) }))
    .sort((a, b) => a.weight - b.weight);

  const picked = [
    sorted[0],
    sorted[Math.floor(sorted.length / 2)],
    sorted[sorted.length - 1],
  ];

  const totalWeight = sorted.reduce((acc, item) => acc + item.weight, 0);
  const sampleWeight = picked.reduce((acc, item) => acc + item.weight, 0);

  return {
    indices: picked.map((p) => p.idx),
    scaleFactor: totalWeight / Math.max(1, sampleWeight),
  };
}

export interface SolveLevelOptions {
  targetBytes: number;
  /** Callback that estimates or measures total output bytes at a given level [0..100] */
  measureBytesAtLevel: (level: number) => Promise<number>;
  /** Initial guess level in [0..100] (defaults to 70) */
  initialLevel?: number;
  /** Maximum number of probe evaluations (defaults to 5) */
  maxIterations?: number;
  /** Stop early if result is within [1 - tolerance, 1.0] of targetBytes */
  toleranceRatio?: number;
}

export interface SolveLevelResult {
  level: number;
  params: EncodingParams;
  measuredBytes: number;
  targetMet: boolean;
  iterations: number;
}

/**
 * Bounded binary search finding the HIGHEST quality level in [0..100]
 * whose measured byte size stays <= targetBytes.
 */
export async function solveCompressionLevel(options: SolveLevelOptions): Promise<SolveLevelResult> {
  const {
    targetBytes,
    measureBytesAtLevel,
    initialLevel = 70,
    maxIterations = 5,
    toleranceRatio = 0.08,
  } = options;

  let lo = 0;
  let hi = 100;
  let iterations = 0;

  let bestUnder: { level: number; bytes: number } | null = null;
  let smallestSeen: { level: number; bytes: number } | null = null;

  let probe = Math.max(0, Math.min(100, Math.round(initialLevel)));
  const visited = new Set<number>();

  while (iterations < maxIterations && lo <= hi) {
    if (visited.has(probe)) {
      probe = Math.floor((lo + hi) / 2);
      if (visited.has(probe)) break;
    }
    visited.add(probe);
    iterations++;

    const bytes = await measureBytesAtLevel(probe);
    if (!smallestSeen || bytes < smallestSeen.bytes) {
      smallestSeen = { level: probe, bytes };
    }

    if (bytes <= targetBytes) {
      if (!bestUnder || probe > bestUnder.level) {
        bestUnder = { level: probe, bytes };
      }
      // Close enough to target without sacrificing quality further
      if (bytes >= targetBytes * (1 - toleranceRatio) || probe === 100) {
        break;
      }
      lo = probe + 1;
    } else {
      hi = probe - 1;
    }

    if (lo > hi) break;
    // On first overshoot from initial probe, if we're way over (> 2.2x), jump lower aggressively
    if (iterations === 1 && bytes > targetBytes * 2.2) {
      probe = Math.max(lo, Math.min(hi, Math.round(probe * 0.35)));
    } else {
      probe = Math.floor((lo + hi) / 2);
    }
  }

  // If no probe landed under target and level 0 wasn't tested yet, test level 0 explicitly
  if (!bestUnder && !visited.has(0)) {
    iterations++;
    const floorBytes = await measureBytesAtLevel(0);
    if (floorBytes <= targetBytes) {
      bestUnder = { level: 0, bytes: floorBytes };
    } else if (!smallestSeen || floorBytes < smallestSeen.bytes) {
      smallestSeen = { level: 0, bytes: floorBytes };
    }
  }

  if (bestUnder) {
    return {
      level: bestUnder.level,
      params: levelToEncodingParams(bestUnder.level),
      measuredBytes: bestUnder.bytes,
      targetMet: true,
      iterations,
    };
  }

  const fallback = smallestSeen ?? { level: 0, bytes: targetBytes };
  return {
    level: fallback.level,
    params: levelToEncodingParams(fallback.level),
    measuredBytes: fallback.bytes,
    targetMet: false,
    iterations,
  };
}
