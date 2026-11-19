import { describe, expect, it } from 'vitest';
import {
  computeDocumentExposureBias,
  computeFastShutterPlan,
  computeMeanLuminance,
  formatShutterSpeed,
  snapToCapabilityRange,
} from '../cameraShutter';

describe('cameraShutter', () => {
  it('snaps capability values cleanly inside bounds and discrete steps', () => {
    expect(snapToCapabilityRange(-0.28, { min: -2, max: 2, step: 0.3333 })).toBeCloseTo(-0.3333, 3);
    expect(snapToCapabilityRange(5000, { min: 100, max: 3200, step: 50 })).toBe(3200);
    expect(snapToCapabilityRange(10, { min: 100, max: 3200, step: 50 })).toBe(100);
  });

  it('formats W3C 100us exposureTime units into readable shutter speeds', () => {
    expect(formatShutterSpeed(100)).toBe('1/100s');
    expect(formatShutterSpeed(167)).toBe('1/60s');
    expect(formatShutterSpeed(333)).toBe('1/30s');
    expect(formatShutterSpeed(0)).toBeUndefined();
  });

  it('computes safe negative EV bias when exposureCompensation range allows it', () => {
    expect(computeDocumentExposureBias({ min: -2, max: 2, step: 0.5 }, -0.3)).toBe(-0.5);
    expect(computeDocumentExposureBias({ min: 0, max: 2, step: 0.5 }, -0.3)).toBeUndefined();
  });

  it('picks 1/100s shutter priority with proportional ISO when headroom exists', () => {
    const plan = computeFastShutterPlan({
      currentExposure: 300, // 1/33s indoor blur risk
      currentIso: 200,
      exposureRange: { min: 1, max: 10000, step: 1 },
      isoRange: { min: 100, max: 3200, step: 10 },
    });
    expect(plan.canApply).toBe(true);
    expect(plan.alreadyFast).toBe(false);
    expect(plan.exposureTime).toBe(100);
    expect(plan.iso).toBe(600);
    expect(plan.shutterLabel).toBe('1/100s');
  });

  it('relaxes smoothly to 1/60s if faster speeds would exceed safe ISO headroom, and leaves continuous AE when too dark', () => {
    const dim = computeFastShutterPlan({
      currentExposure: 300,
      currentIso: 1400,
      exposureRange: { min: 1, max: 10000, step: 1 },
      isoRange: { min: 100, max: 3200, step: 50 },
    });
    expect(dim.canApply).toBe(true);
    expect(dim.exposureTime).toBe(167); // 1/60s needs ~2515 ISO <= 2720 safe cap
    expect(dim.iso).toBeGreaterThan(2000);
    expect(dim.shutterLabel).toBe('1/60s');

    const pitchDark = computeFastShutterPlan({
      currentExposure: 400,
      currentIso: 1800,
      exposureRange: { min: 1, max: 10000, step: 1 },
      isoRange: { min: 100, max: 3200, step: 50 },
    });
    expect(pitchDark.canApply).toBe(false);
  });

  it('marks alreadyFast when continuous AE is already at or faster than 1/100s', () => {
    const bright = computeFastShutterPlan({
      currentExposure: 60,
      currentIso: 100,
      exposureRange: { min: 1, max: 10000, step: 1 },
      isoRange: { min: 100, max: 3200, step: 50 },
    });
    expect(bright.canApply).toBe(true);
    expect(bright.alreadyFast).toBe(true);
    expect(bright.shutterLabel).toBe('1/167s');
  });

  it('computes fast strided mean luminance accurately', () => {
    const rgba = new Uint8ClampedArray([
      200, 200, 200, 255,
      100, 100, 100, 255,
      200, 200, 200, 255,
      100, 100, 100, 255,
    ]);
    expect(computeMeanLuminance(rgba, 2)).toBeCloseTo(200, 0);
    expect(computeMeanLuminance(rgba, 1)).toBeCloseTo(150, 0);
  });
});
