export const MAX_INGEST_DIM = 2200;
export const PREVIEW_MAX_DIM = 900;
export const THUMBNAIL_MAX_DIM = 400;

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode canvas to image blob.'));
      },
      mime,
      quality
    );
  });
}

/**
 * Decodes an image Blob/File with automatic EXIF orientation handling
 * (via createImageBitmap where available, with Image element fallback).
 */
async function decodeBlobToSource(
  blob: Blob
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fallback below for browsers/codecs where createImageBitmap fails
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Downscales an incoming camera/gallery photo to a safe working resolution (<= 2200px)
 * and bakes EXIF orientation into a clean JPEG Blob. Prevents mobile Safari/Chrome RAM crashes.
 */
export async function ingestImageBlob(
  blob: Blob,
  maxDim = MAX_INGEST_DIM,
  quality = 0.92
): Promise<{ blob: Blob; width: number; height: number }> {
  const decoded = await decodeBlobToSource(blob);
  const canvas = document.createElement('canvas');
  try {
    let targetW = decoded.width;
    let targetH = decoded.height;
    const longest = Math.max(targetW, targetH);
    if (longest > maxDim) {
      const scale = maxDim / longest;
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));
    }

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, targetW, targetH);

    const outBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
    return { blob: outBlob, width: targetW, height: targetH };
  } finally {
    decoded.close();
    releaseCanvas(canvas);
  }
}

/**
 * Extracts raw RGBA ImageData from a Blob, optionally downscaled to maxDim for fast previewing.
 */
export async function blobToImageData(
  blob: Blob,
  maxDim?: number
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const decoded = await decodeBlobToSource(blob);
  const canvas = document.createElement('canvas');
  try {
    let targetW = decoded.width;
    let targetH = decoded.height;
    if (maxDim && Math.max(targetW, targetH) > maxDim) {
      const scale = maxDim / Math.max(targetW, targetH);
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));
    }

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(decoded.source, 0, 0, targetW, targetH);
    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    return { pixels: imgData.data, width: targetW, height: targetH };
  } finally {
    decoded.close();
    releaseCanvas(canvas);
  }
}

/**
 * Encodes a processed RGBA pixel buffer into a JPEG Blob and immediately releases canvas memory.
 */
export async function rgbaToJpegBlob(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  quality = 0.88
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    const safeBuffer = new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength);
    const imageData = new ImageData(safeBuffer, width, height);
    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas, 'image/jpeg', quality);
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Generates a small thumbnail Blob for the multi-page workspace grid.
 */
export async function createThumbnailBlob(blob: Blob, maxDim = THUMBNAIL_MAX_DIM): Promise<Blob> {
  const result = await ingestImageBlob(blob, maxDim, 0.78);
  return result.blob;
}

/**
 * Re-encodes an existing image Blob at a target max dimension & JPEG quality for PDF export.
 */
export async function reencodeForPdf(blob: Blob, maxDim: number, quality: number): Promise<Uint8Array> {
  const resized = await ingestImageBlob(blob, maxDim, quality);
  const arrBuf = await resized.blob.arrayBuffer();
  return new Uint8Array(arrBuf);
}
