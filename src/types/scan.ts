export interface Point {
  /** Normalized X coordinate in [0..1] relative to original image width */
  x: number;
  /** Normalized Y coordinate in [0..1] relative to original image height */
  y: number;
}

/** Ordered clockwise: [topLeft, topRight, bottomRight, bottomLeft] */
export type Quad = [Point, Point, Point, Point];

export type Rotation = 0 | 90 | 180 | 270;

export type FilterPreset = 'pure-color' | 'pure-bw' | 'grayscale' | 'original';

export type AspectMode = 'auto' | 'a4' | 'letter';

export interface FilterAdjustments {
  /** Background illumination removal strength (0..100) */
  shadowStrength: number;
  /** Contrast offset (-50..50) */
  contrast: number;
  /** Brightness offset (-50..50) */
  brightness: number;
}

export const DEFAULT_ADJUSTMENTS: FilterAdjustments = {
  shadowStrength: 96,
  contrast: 0,
  brightness: 0,
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
    label: 'Pure Color',
    code: 'PURE_CLR',
    description: 'Removes shadows & yellow cast while keeping ink and stamps vivid',
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

export type PdfPageSize = 'a4' | 'letter' | 'fit';
export type PdfMargin = 'none' | 'small' | 'standard';
export type PdfQuality = 'small' | 'balanced' | 'high';

export interface ExportOptions {
  filename: string;
  pageSize: PdfPageSize;
  margin: PdfMargin;
  quality: PdfQuality;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  byteSize: number;
  pageCount: number;
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
}

export interface WorkerProcessResponse {
  requestId: number;
  pixels?: ArrayBuffer;
  width?: number;
  height?: number;
  error?: string;
}
