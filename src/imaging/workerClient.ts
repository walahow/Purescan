import type {
  AspectMode,
  FilterAdjustments,
  FilterPreset,
  Quad,
  Rotation,
  WorkerProcessRequest,
  WorkerProcessResponse,
} from '../types/scan';
import { computeTargetSize, rotateImageBuffer, warpPerspective } from './perspective';
import { applyDocumentFilter } from './filters';

export interface ProcessParams {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  quad: Quad;
  aspectMode: AspectMode;
  rotation: Rotation;
  filter: FilterPreset;
  adjustments: FilterAdjustments;
  maxOutputDim: number;
}

export interface ProcessOutput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface PendingJob {
  resolve: (result: ProcessOutput) => void;
  reject: (err: Error) => void;
}

let sharedWorker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<number, PendingJob>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(new URL('../workers/imageProcessor.worker.ts', import.meta.url), {
        type: 'module',
      });
      sharedWorker.onmessage = (event: MessageEvent<WorkerProcessResponse>) => {
        const res = event.data;
        const job = pending.get(res.requestId);
        if (!job) return;
        pending.delete(res.requestId);
        if (res.error || !res.pixels || !res.width || !res.height) {
          job.reject(new Error(res.error || 'Worker returned empty image result.'));
        } else {
          job.resolve({
            pixels: new Uint8ClampedArray(res.pixels),
            width: res.width,
            height: res.height,
          });
        }
      };
      sharedWorker.onerror = () => {
        workerFailed = true;
        sharedWorker?.terminate();
        sharedWorker = null;
        for (const [, job] of pending) {
          job.reject(new Error('Image worker crashed — retrying on main thread.'));
        }
        pending.clear();
      };
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return sharedWorker;
}

function processSynchronously(params: ProcessParams): ProcessOutput {
  const target = computeTargetSize(params.quad, params.width, params.height, params.aspectMode, params.maxOutputDim);
  const warped = warpPerspective(params.pixels, params.width, params.height, params.quad, target.width, target.height);
  const filtered = applyDocumentFilter(warped, target.width, target.height, params.filter, params.adjustments);
  return rotateImageBuffer(filtered, target.width, target.height, params.rotation);
}

/**
 * Runs perspective warp + shadow-removal filter + rotation inside the dedicated Web Worker
 * using zero-copy ArrayBuffer transfer, with automatic fallback if Workers are unavailable.
 */
export async function processImageInWorker(params: ProcessParams): Promise<ProcessOutput> {
  const worker = getWorker();
  if (!worker) {
    return processSynchronously(params);
  }

  // Copy buffer so caller can still safely hold original pixels for live slider preview
  const copy = new Uint8ClampedArray(params.pixels.length);
  copy.set(params.pixels);
  const transferBuf = copy.buffer;

  const requestId = nextRequestId++;
  const payload: WorkerProcessRequest = {
    requestId,
    pixels: transferBuf,
    width: params.width,
    height: params.height,
    quad: params.quad,
    aspectMode: params.aspectMode,
    rotation: params.rotation,
    filter: params.filter,
    adjustments: params.adjustments,
    maxOutputDim: params.maxOutputDim,
  };

  try {
    return await new Promise<ProcessOutput>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      worker.postMessage(payload, [transferBuf]);
    });
  } catch {
    // Graceful fallback so users are never blocked if a browser restricts module workers
    return processSynchronously(params);
  }
}
