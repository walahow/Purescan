/// <reference lib="webworker" />

import { computeTargetSize, rotateImageBuffer, warpPerspective } from '../imaging/perspective';
import { applyDocumentFilter } from '../imaging/filters';
import type { WorkerProcessRequest, WorkerProcessResponse } from '../types/scan';

const workerSelf = self as unknown as DedicatedWorkerGlobalScope;

workerSelf.onmessage = (event: MessageEvent<WorkerProcessRequest>) => {
  const req = event.data;
  try {
    const srcPixels = new Uint8ClampedArray(req.pixels);
    const target = computeTargetSize(req.quad, req.width, req.height, req.aspectMode, req.maxOutputDim);

    // 1. Perspective warp from 4-corner quad
    const warped = warpPerspective(
      srcPixels,
      req.width,
      req.height,
      req.quad,
      target.width,
      target.height,
      Boolean(req.highQualityWarp)
    );

    // 2. Apply document enhancement / shadow-removal filter
    const filtered = applyDocumentFilter(warped, target.width, target.height, req.filter, req.adjustments);

    // 3. Apply 90-degree step rotation
    const rotated = rotateImageBuffer(filtered, target.width, target.height, req.rotation);

    const outBuffer = rotated.pixels.buffer as ArrayBuffer;
    const response: WorkerProcessResponse = {
      requestId: req.requestId,
      pixels: outBuffer,
      width: rotated.width,
      height: rotated.height,
    };

    workerSelf.postMessage(response, [outBuffer]);
  } catch (err) {
    const response: WorkerProcessResponse = {
      requestId: req.requestId,
      error: err instanceof Error ? err.message : 'Image processing failed in worker.',
    };
    workerSelf.postMessage(response);
  }
};
