export interface Point {
  /** Normalized X coordinate in [0..1] relative to original image width */
  x: number;
  /** Normalized Y coordinate in [0..1] relative to original image height */
  y: number;
}

/** Ordered clockwise: [topLeft, topRight, bottomRight, bottomLeft] */
export type Quad = [Point, Point, Point, Point];

export type Rotation = 0 | 90 | 180 | 270;

export type FilterPreset = 'pure-color' | 'no-shadow' | 'pure-bw' | 'grayscale' | 'original';

export type AspectMode = 'auto' | 'a4' | 'letter' | 'f4' | 'legal' | 'id-card' | 'square';

export type CameraGuideId = 'a4' | 'f4' | 'letter' | 'legal' | 'id-card' | 'free';

export type GuideOrientation = 'auto' | 'portrait' | 'landscape';

export interface FilterAdjustments {
  /** Background illumination removal strength (0..100) */
  shadowStrength: number;
  /** Contrast offset (-50..50) */
  contrast: number;
  /** Brightness offset (-50..50) */
  brightness: number;
}

export const DEFAULT_ADJUSTMENTS: FilterAdjustments = {
  shadowStrength: 100,
  contrast: 10,
  brightness: 5,
};

export interface FilterPresetMeta {
  id: FilterPreset;
  label: string;
  code: string;
  description: string;
}

export const FILTER_PRESETS: FilterPresetMeta[] = [
  {
    id: 'pure-color',
    label: 'Magic Color',
    code: 'MAGIC_CLR',
    description: 'Ajaib — Pure white paper, razor-sharp ink & vivid colors',
  },
  {
    id: 'no-shadow',
    label: 'No Shadow',
    code: 'NO_SHDW',
    description: 'Tanpa Bayangan — Erases shadows while keeping natural tones & photos',
  },
  {
    id: 'pure-bw',
    label: 'Pure B&W',
    code: 'PURE_BW',
    description: 'Pure white paper with crisp high-contrast black text',
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    code: 'GRAY_DOC',
    description: 'Shadow-free smooth grayscale for sketches & forms',
  },
  {
    id: 'original',
    label: 'Original',
    code: 'RAW_ORIG',
    description: 'Perspective-corrected photo without shadow filter',
  },
];

export interface ScanPage {
  id: string;
  order: number;
  createdAt: number;
  originalBlob: Blob;
  originalWidth: number;
  originalHeight: number;
  quad: Quad;
  aspectMode: AspectMode;
  rotation: Rotation;
  filter: FilterPreset;
  adjustments: FilterAdjustments;
  processedBlob: Blob;
  processedWidth: number;
  processedHeight: number;
  thumbnailBlob: Blob;
}

export interface DocumentMeta {
  id: 'active';
  title: string;
  updatedAt: number;
}

export type PdfPageSize = 'a4' | 'f4' | 'letter' | 'legal' | 'id-card' | 'fit';
export type PdfMargin = 'none' | 'small' | 'standard';
export type PdfQuality = 'ultra' | 'small' | 'balanced' | 'high';
export type PdfCompressionMode = 'preset' | 'target-size';
export type PdfBwEncoding = 'auto' | 'mono-1bit' | 'jpeg';

export interface ExportOptions {
  filename: string;
  pageSize: PdfPageSize;
  margin: PdfMargin;
  quality: PdfQuality;
  compressionMode: PdfCompressionMode;
  /** Target maximum output file size in bytes (used when compressionMode === 'target-size') */
  targetMaxBytes?: number;
  /** 'auto': 1-bit Flate for pure-bw pages & JPEG for color/gray; 'mono-1bit': force all pages to 1-bit B&W; 'jpeg': force JPEG */
  bwEncoding: PdfBwEncoding;
}

export interface ExportProgress {
  current: number;
  total: number;
  stage?: string;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  byteSize: number;
  sourceBytes: number;
  pageCount: number;
  monoPageCount: number;
  jpegPageCount: number;
  targetMet?: boolean;
  appliedProfileLabel: string;
}

export type PdfCompressPreset = 'ultra' | 'small' | 'balanced';

export interface PdfImageSkipSummary {
  transparency: number;
  alreadyCompactOrSmall: number;
  unsupportedCodec: number;
}

export interface PdfInspectionReport {
  filename: string;
  pageCount: number;
  totalBytes: number;
  totalImages: number;
  compressibleImages: number;
  compressibleBytes: number;
  skippedImages: number;
  skipReasons: PdfImageSkipSummary;
  /** Percentage of total PDF bytes accounted for by compressible Image XObjects (0..100) */
  imageSharePercent: number;
}

export interface PdfCompressOptions {
  compressionMode: PdfCompressionMode;
  preset: PdfCompressPreset;
  targetMaxBytes?: number;
  /** Convert compressible images to crisp 1-bit monochrome Flate streams */
  forceMono1Bit: boolean;
  /** Strip PDF info metadata & XMP stream */
  stripMetadata: boolean;
}

export interface PdfCompressProgress {
  current: number;
  total: number;
  stage: string;
}

export interface PdfCompressResult {
  blob: Blob;
  filename: string;
  originalBytes: number;
  compressedBytes: number;
  pageCount: number;
  recompressedImages: number;
  skippedImages: number;
  alreadyOptimal: boolean;
  targetMet?: boolean;
  appliedProfileLabel: string;
}

export type SharpnessStatus = 'sharp' | 'fair' | 'blurry';

export interface SharpnessReport {
  score: number;
  status: SharpnessStatus;
}

export interface DocumentDetectionResult {
  quad: Quad;
  confidence: number;
  detected: boolean;
}

export interface CameraCaptureResult {
  blob: Blob;
  fallbackQuad?: Quad;
  suggestedAspectMode?: AspectMode;
}

export interface WorkerProcessRequest {
  requestId: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  quad: Quad;
  aspectMode: AspectMode;
  rotation: Rotation;
  filter: FilterPreset;
  adjustments: FilterAdjustments;
  maxOutputDim: number;
  highQualityWarp?: boolean;
}

export interface WorkerProcessResponse {
  requestId: number;
  pixels?: ArrayBuffer;
  width?: number;
  height?: number;
  error?: string;
}
