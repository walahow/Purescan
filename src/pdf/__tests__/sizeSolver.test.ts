import { describe, expect, it } from 'vitest';
import {
  levelToEncodingParams,
  selectRepresentativeIndices,
  solveCompressionLevel,
} from '../sizeSolver';

describe('PDF target-size compression solver', () => {
  it('maps levels 0..100 monotonically to maxDim and jpegQuality', () => {
    let prevDim = 0;
    let prevQ = 0;
    for (let lvl = 0; lvl <= 100; lvl += 5) {
      const p = levelToEncodingParams(lvl);
      expect(p.maxDim).toBeGreaterThanOrEqual(prevDim);
      expect(p.jpegQuality).toBeGreaterThanOrEqual(prevQ);
      prevDim = p.maxDim;
      prevQ = p.jpegQuality;
    }
    expect(levelToEncodingParams(0)).toEqual({ level: 0, maxDim: 780, jpegQuality: 0.38 });
    expect(levelToEncodingParams(100)).toEqual({ level: 100, maxDim: 2200, jpegQuality: 0.88 });
  });

  it('selects lightest, median, and heaviest indices when weight count exceeds maxSamples', () => {
    const weights = [120, 900, 300, 50, 600, 450, 1500];
    const res = selectRepresentativeIndices(weights, 3);
    expect(res.indices.length).toBe(3);
    expect(res.indices).toContain(3); // lightest (50)
    expect(res.indices).toContain(6); // heaviest (1500)
    expect(res.scaleFactor).toBeGreaterThan(1);
  });

  it('converges to the highest level under targetBytes within bounded iterations', async () => {
    // Synthetic monotonic curve: 100 KB at level 0 up to 1100 KB at level 100
    const mockSize = async (level: number) => 100_000 + level * 10_000;
    const result = await solveCompressionLevel({
      targetBytes: 500_000,
      measureBytesAtLevel: mockSize,
      maxIterations: 6,
    });

    expect(result.targetMet).toBe(true);
    expect(result.measuredBytes).toBeLessThanOrEqual(500_000);
    expect(result.level).toBeGreaterThanOrEqual(35);
    expect(result.level).toBeLessThanOrEqual(40);
    expect(result.iterations).toBeLessThanOrEqual(6);
  });

  it('reports targetMet: false honestly when target is below minimum achievable bytes', async () => {
    const mockSize = async (level: number) => 250_000 + level * 8_000;
    const result = await solveCompressionLevel({
      targetBytes: 150_000,
      measureBytesAtLevel: mockSize,
      maxIterations: 5,
    });

    expect(result.targetMet).toBe(false);
    expect(result.level).toBe(0);
    expect(result.measuredBytes).toBe(250_000);
  });
});
