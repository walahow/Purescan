import type { SharpnessReport, SharpnessStatus } from '../types/scan';

/**
 * Computes a lighting- and margin-invariant sharpness score on the central 60% ROI
 * of an RGBA image buffer using normalized 3x3 Laplacian edge energy.
 *
 * Works on a downsampled <= 320px luminance grid so execution takes ~1-3 ms on mobile.
 */
export function computeSharpnessScore(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): SharpnessReport {
  if (width < 12 || height < 12) {
    return { score: 0, status: 'blurry' };
  }

  // Downsample to <= 320px longest edge using area-like strided averaging
  const targetMax = 320;
  const maxDim = Math.max(width, height);
  const step = maxDim > targetMax ? Math.max(2, Math.floor(maxDim / targetMax)) : 1;
  const w = Math.floor(width / step);
  const h = Math.floor(height / step);

  if (w < 8 || h < 8) {
    return { score: 0, status: 'blurry' };
  }

  const lum = new Float32Array(w * h);
  if (step === 1) {
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      lum[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    }
  } else {
    const invStep2 = 1 / (step * step);
    for (let y = 0; y < h; y++) {
      const sy0 = y * step;
      for (let x = 0; x < w; x++) {
        const sx0 = x * step;
        let sum = 0;
        for (let dy = 0; dy < step; dy++) {
          const row = (sy0 + dy) * width;
          for (let dx = 0; dx < step; dx++) {
            const p = (row + sx0 + dx) * 4;
            sum += 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
          }
        }
        lum[y * w + x] = sum * invStep2;
      }
    }
  }

  // Evaluate central 60% ROI where the document sits
  const x0 = Math.max(1, Math.floor(w * 0.2));
  const x1 = Math.min(w - 2, Math.ceil(w * 0.8));
  const y0 = Math.max(1, Math.floor(h * 0.2));
  const y1 = Math.min(h - 2, Math.ceil(h * 0.8));

  const roiW = x1 - x0 + 1;
  const roiH = y1 - y0 + 1;
  const roiCount = roiW * roiH;
  if (roiCount <= 0) {
    return { score: 0, status: 'blurry' };
  }

  let meanLum = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      meanLum += lum[row + x];
    }
  }
  meanLum /= roiCount;

  // Normalize brightness to reference 180 so dim rooms don't falsely report as blurry
  const lumScale = 180 / Math.max(48, meanLum);
  const clampedScale = Math.min(2.6, Math.max(0.7, lumScale));

  const energies = new Float32Array(roiCount);
  let idx = 0;
  let totalVar = 0;

  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      const c = lum[row + x];
      const lap =
        4 * c - lum[row + x - 1] - lum[row + x + 1] - lum[row - w + x] - lum[row + w + x];
      const normLap = lap * clampedScale;
      const e = normLap * normLap;
      energies[idx++] = e;
      totalVar += e;
    }
  }

  // Combine overall ROI Laplacian variance with top-5% peak edge energy so sparse pages
  // (e.g. mostly white paper with a single crisp title) still score accurately.
  energies.sort();
  const topStart = Math.max(0, Math.floor(roiCount * 0.95));
  let topSum = 0;
  const topCount = roiCount - topStart;
  for (let i = topStart; i < roiCount; i++) {
    topSum += energies[i];
  }

  const meanEnergy = totalVar / roiCount;
  const top5Energy = topSum / Math.max(1, topCount);
  // Linear RMS blend (in 0..300+ range) is less sensitive to isolated outlier pixels
  const score = Math.round(Math.sqrt(top5Energy) * 0.55 + Math.sqrt(meanEnergy) * 0.45);

  let status: SharpnessStatus;
  if (score >= 80) {
    status = 'sharp';
  } else if (score >= 38) {
    status = 'fair';
  } else {
    status = 'blurry';
  }

  return { score, status };
}
