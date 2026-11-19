import { DEFAULT_ADJUSTMENTS } from '../types/scan';
import { applyDocumentFilter } from './filters';
import { packRgbaTo1Bit } from './monochrome';

export const MAX_INGEST_DIM = 3200;
export const MAX_OUTPUT_DIM = 2400;
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
 * Downscales an incoming camera/gallery photo to a safe working resolution (<= 3200px)
 * and bakes EXIF orientation into a clean JPEG Blob. Prevents mobile Safari/Chrome RAM crashes
 * while preserving ~250-300 DPI detail for cropped document regions.
 */
export async function ingestImageBlob(
  blob: Blob,
  maxDim = MAX_INGEST_DIM,
  quality = 0.94
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
 * Center-crops an image Blob to match targetAspect (width / height) when its natural
 * aspect ratio differs by > 2%, guaranteeing 1:1 WYSIWYG framing between live camera
 * preview and high-resolution ImageCapture.takePhoto() stills.
 */
export async function cropBlobToAspectRatio(
  blob: Blob,
  targetAspect: number,
  quality = 0.95
): Promise<Blob> {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return blob;
  const decoded = await decodeBlobToSource(blob);
  const srcW = decoded.width;
  const srcH = decoded.height;
  if (srcW <= 0 || srcH <= 0) {
    decoded.close();
    return blob;
  }

  const srcAspect = srcW / srcH;
  if (Math.abs(srcAspect - targetAspect) / targetAspect <= 0.02) {
    decoded.close();
    return blob;
  }

  const canvas = document.createElement('canvas');
  try {
    let sx = 0;
    let sy = 0;
    let cropW = srcW;
    let cropH = srcH;

    if (srcAspect > targetAspect) {
      cropW = Math.max(1, Math.round(srcH * targetAspect));
      sx = Math.floor((srcW - cropW) / 2);
    } else {
      cropH = Math.max(1, Math.round(srcW / targetAspect));
      sy = Math.floor((srcH - cropH) / 2);
    }

    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return blob;
    ctx.drawImage(decoded.source, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    return await canvasToBlob(canvas, 'image/jpeg', quality);
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

/**
 * Zero-waste JPEG encoder for PDF export:
 * - Passes through the existing JPEG bytes untouched when already within maxDim and quality >= srcQualityHint.
 * - Never returns a larger JPEG than the original Blob when dimensions are unchanged.
 */
export async function encodeBlobAsJpegSafe(
  blob: Blob,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
  quality: number,
  srcQualityHint = 0.88
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const isJpeg = blob.type === 'image/jpeg' || blob.type === 'image/jpg';
  const longest = Math.max(srcWidth, srcHeight);

  if (isJpeg && longest > 0 && longest <= maxDim && quality >= srcQualityHint) {
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: srcWidth,
      height: srcHeight,
    };
  }

  const resized = await ingestImageBlob(blob, maxDim, quality);
  if (isJpeg && resized.width === srcWidth && resized.height === srcHeight && resized.blob.size >= blob.size) {
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: srcWidth,
      height: srcHeight,
    };
  }

  return {
    bytes: new Uint8Array(await resized.blob.arrayBuffer()),
    width: resized.width,
    height: resized.height,
  };
}

/**
 * Decodes an image Blob (downscaled to maxDim) and packs it into a PDF-ready 1-bit monochrome stream.
 * Optionally applies Pure B&W illumination normalization first when the source still contains shadows.
 */
export async function encodeBlobAsMono1Bit(
  blob: Blob,
  maxDim: number,
  options: { isAlreadyBw: boolean; needsShadowRemoval: boolean }
): Promise<{ packedBits: Uint8Array; width: number; height: number }> {
  const img = await blobToImageData(blob, maxDim);
  let pixels = img.pixels;

  if (options.needsShadowRemoval) {
    pixels = applyDocumentFilter(pixels, img.width, img.height, 'pure-bw', DEFAULT_ADJUSTMENTS);
  }

  const packed = packRgbaTo1Bit(
    pixels,
    img.width,
    img.height,
    options.isAlreadyBw || options.needsShadowRemoval ? 165 : undefined
  );

  return {
    packedBits: packed.packedBits,
    width: packed.width,
    height: packed.height,
  };
}

/**
 * Downscales raw RGBA pixels on an offscreen canvas and encodes to JPEG bytes.
 * Used by Phase B (Existing PDF Compressor) for /FlateDecode image XObjects.
 */
export async function rgbaToScaledJpegBytes(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
  quality: number
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const srcCanvas = document.createElement('canvas');
  const dstCanvas = document.createElement('canvas');
  try {
    srcCanvas.width = srcWidth;
    srcCanvas.height = srcHeight;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) throw new Error('Canvas 2D context unavailable.');
    const safeBuffer = new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength);
    srcCtx.putImageData(new ImageData(safeBuffer, srcWidth, srcHeight), 0, 0);

    let targetW = srcWidth;
    let targetH = srcHeight;
    const longest = Math.max(srcWidth, srcHeight);
    if (longest > maxDim) {
      const s = maxDim / longest;
      targetW = Math.max(1, Math.round(srcWidth * s));
      targetH = Math.max(1, Math.round(srcHeight * s));
    }

    if (targetW === srcWidth && targetH === srcHeight) {
      const blob = await canvasToBlob(srcCanvas, 'image/jpeg', quality);
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width: targetW, height: targetH };
    }

    dstCanvas.width = targetW;
    dstCanvas.height = targetH;
    const dstCtx = dstCanvas.getContext('2d', { alpha: false });
    if (!dstCtx) throw new Error('Canvas 2D context unavailable.');
    dstCtx.fillStyle = '#ffffff';
    dstCtx.fillRect(0, 0, targetW, targetH);
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

    const blob = await canvasToBlob(dstCanvas, 'image/jpeg', quality);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: targetW, height: targetH };
  } finally {
    releaseCanvas(srcCanvas);
    releaseCanvas(dstCanvas);
  }
}

/**
 * Downscales raw RGBA pixels on an offscreen canvas and packs into a 1-bit monochrome stream.
 * Optionally applies Pure B&W shadow normalization so shadowed document scans stay readable.
 */
export function rgbaToScaledMono1Bit(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
  options?: { applyShadowRemoval?: boolean }
): { packedBits: Uint8Array; width: number; height: number } {
  const applyShadow = options?.applyShadowRemoval ?? true;
  const longest = Math.max(srcWidth, srcHeight);
  if (longest <= maxDim) {
    const clean = applyShadow
      ? applyDocumentFilter(pixels, srcWidth, srcHeight, 'pure-bw', DEFAULT_ADJUSTMENTS)
      : pixels;
    const packed = packRgbaTo1Bit(clean, srcWidth, srcHeight, applyShadow ? 165 : undefined);
    return { packedBits: packed.packedBits, width: packed.width, height: packed.height };
  }

  const s = maxDim / longest;
  const targetW = Math.max(1, Math.round(srcWidth * s));
  const targetH = Math.max(1, Math.round(srcHeight * s));

  const srcCanvas = document.createElement('canvas');
  const dstCanvas = document.createElement('canvas');
  try {
    srcCanvas.width = srcWidth;
    srcCanvas.height = srcHeight;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) throw new Error('Canvas 2D context unavailable.');
    const safeBuffer = new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength);
    srcCtx.putImageData(new ImageData(safeBuffer, srcWidth, srcHeight), 0, 0);

    dstCanvas.width = targetW;
    dstCanvas.height = targetH;
    const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
    if (!dstCtx) throw new Error('Canvas 2D context unavailable.');
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

    const resized = dstCtx.getImageData(0, 0, targetW, targetH);
    const clean = applyShadow
      ? applyDocumentFilter(resized.data, targetW, targetH, 'pure-bw', DEFAULT_ADJUSTMENTS)
      : resized.data;
    const packed = packRgbaTo1Bit(clean, targetW, targetH, applyShadow ? 165 : undefined);
    return { packedBits: packed.packedBits, width: packed.width, height: packed.height };
  } finally {
    releaseCanvas(srcCanvas);
    releaseCanvas(dstCanvas);
  }
}
