export interface NumericRangeCapability {
  min?: number;
  max?: number;
  step?: number;
}

export interface FastShutterPlan {
  /** Whether hardware capabilities + live readings support locking a fast shutter speed */
  canApply: boolean;
  /** True when hardware auto-exposure is already at or faster than target shutter speed */
  alreadyFast: boolean;
  /** Target exposure time in W3C 100µs units (e.g. 100 = 1/100s, 167 = 1/60s) */
  exposureTime?: number;
  /** Compensated ISO scaled to preserve scene brightness */
  iso?: number;
  /** Human-readable shutter speed label (e.g. "1/100s") */
  shutterLabel?: string;
}

/** Clamps value inside [min, max] and snaps to the capability's discrete step size. */
export function snapToCapabilityRange(value: number, range?: NumericRangeCapability): number {
  if (!range) return value;
  const min = Number.isFinite(range.min) ? (range.min as number) : -Infinity;
  const max = Number.isFinite(range.max) ? (range.max as number) : Infinity;
  const clamped = Math.max(min, Math.min(max, value));
  if (range.step && Number.isFinite(range.step) && range.step > 0 && Number.isFinite(min)) {
    const steps = Math.round((clamped - min) / range.step);
    const snapped = min + steps * range.step;
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(4));
  }
  return clamped;
}

/** Formats W3C ImageCapture exposureTime (100µs units) as a photography shutter string. */
export function formatShutterSpeed(exposure100Us?: number): string | undefined {
  if (!exposure100Us || !Number.isFinite(exposure100Us) || exposure100Us <= 0) return undefined;
  const seconds = exposure100Us * 0.0001;
  if (seconds < 0.5) {
    const denom = Math.max(1, Math.round(1 / seconds));
    return `1/${denom}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

/**
 * Selects a gentle negative EV bias (default -0.3 EV) for continuous AE so hardware
 * favors slightly faster shutter speeds and protects white paper ink from bloom.
 */
export function computeDocumentExposureBias(
  range?: NumericRangeCapability,
  desiredEv = -0.3
): number | undefined {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return undefined;
  if ((range.min as number) >= 0 || (range.max as number) < (range.min as number)) return undefined;
  const snapped = snapToCapabilityRange(desiredEv, range);
  return snapped < 0 ? snapped : undefined;
}

/**
 * Computes a shutter-priority (fast exposure + proportional ISO) constraint pair from
 * live hardware AE telemetry. Falls back gracefully if shutter is already fast or room
 * illumination would require clipping ISO above safe noise limits.
 */
export function computeFastShutterPlan(params: {
  currentExposure?: number;
  currentIso?: number;
  exposureRange?: NumericRangeCapability;
  isoRange?: NumericRangeCapability;
  targetExposure?: number;
  maxExposure?: number;
}): FastShutterPlan {
  const {
    currentExposure,
    currentIso,
    exposureRange,
    isoRange,
    targetExposure = 100, // 1/100s
    maxExposure = 167, // 1/60s
  } = params;

  if (
    !currentExposure ||
    !Number.isFinite(currentExposure) ||
    currentExposure <= 0 ||
    !currentIso ||
    !Number.isFinite(currentIso) ||
    currentIso <= 0 ||
    !exposureRange ||
    !isoRange ||
    !Number.isFinite(exposureRange.min) ||
    !Number.isFinite(exposureRange.max) ||
    !Number.isFinite(isoRange.min) ||
    !Number.isFinite(isoRange.max)
  ) {
    return { canApply: false, alreadyFast: false };
  }

  if (currentExposure <= targetExposure * 1.05) {
    return {
      canApply: true,
      alreadyFast: true,
      shutterLabel: formatShutterSpeed(currentExposure),
    };
  }

  const minExp = exposureRange.min as number;
  const maxExp = exposureRange.max as number;
  const safeMaxIso = (isoRange.max as number) * 0.85;

  // Candidate shutter targets from crisp 1/100s down to 1/60s ceiling
  const candidates = [targetExposure, Math.round((targetExposure + maxExposure) * 0.5), maxExposure];
  for (const rawExp of candidates) {
    if (rawExp >= currentExposure * 0.92) continue;
    const clampedExp = snapToCapabilityRange(Math.max(minExp, Math.min(maxExp, rawExp)), exposureRange);
    const neededIso = currentIso * (currentExposure / clampedExp);
    if (neededIso <= safeMaxIso) {
      const snappedIso = snapToCapabilityRange(neededIso, isoRange);
      return {
        canApply: true,
        alreadyFast: false,
        exposureTime: clampedExp,
        iso: snappedIso,
        shutterLabel: formatShutterSpeed(clampedExp),
      };
    }
  }

  return { canApply: false, alreadyFast: false };
}

/** Fast strided BT.601 luminance average [0..255] for live exposure health checks. */
export function computeMeanLuminance(rgba: Uint8ClampedArray, pixelStride = 4): number {
  const step = Math.max(1, pixelStride) * 4;
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < rgba.length; i += step) {
    sum += rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    count++;
  }
  return count > 0 ? sum / count : 128;
}
