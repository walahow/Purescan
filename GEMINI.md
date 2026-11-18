# PureScan (`d:\proj\PDFConvert`) — Project Handoff

## What It Is
**PureScan** is a 100% client-side, ad-free, watermark-free web document scanner (CamScanner replacement) built as a static Progressive Web App (PWA) ready for Vercel Hobby deployment. All image capture, 4-corner perspective warping, shadow removal ("Pure" filters), multi-page management, and PDF assembly happen entirely on the user's device — zero server compute, zero file uploads, and full offline support once installed.

The UI follows the visual design system of **HYDE (`D:\proj\HYDE`)**: sharp `rounded-none` architectural edges, monochrome palette (`white`, `#f5f5f7`, `zinc-900`, emerald `#2eb846` accents), monospace telemetry labels, extended hairline crop-mark frames, interactive 40×40 SVG grid background, Bayer dither card hover overlays, and a split-panel document studio layout on desktop.

---

## Tech Stack & Key Architecture
- **Frontend**: Vite 6 + React 19 + TypeScript (strict) + Tailwind CSS v4 + `lucide-react`
- **PWA / Offline**: `vite-plugin-pwa` (Workbox precaching, `skipWaiting` + `clientsClaim`, installable standalone manifest, custom SVG + maskable icons)
- **Imaging Engine (No OpenCV.js WASM)**:
  - `src/imaging/perspective.ts` — Convex clockwise quad validation, A4/Letter/Auto output sizing, 8×8 Gaussian elimination inverse homography solver, bilinear perspective warp, and 90° pixel buffer rotation.
  - `src/imaging/filters.ts` — Border-replicated morphological closing (`dilate` → `erode` on downscaled block-max grid + 1-pass blur + p85 floor guard) for illumination estimation, per-channel/luminance illumination division, white/black stretch, subtle saturation boost, and edge-aware 3×3 unsharp mask. Presets: `pure-color` (Magic Color), `pure-bw` (anti-aliased soft-threshold B&W), `grayscale`, `original`.
  - `src/workers/imageProcessor.worker.ts` + `src/imaging/workerClient.ts` — Dedicated ES Module Web Worker (**7.3 KB** compiled) using zero-copy `ArrayBuffer` transfers, with synchronous fallback if a browser blocks module workers.
  - `src/imaging/ingest.ts` — EXIF-aware decode (`createImageBitmap` + `<img>` fallback), downscaling to `<= 2200 px` long edge to protect mobile Safari/Chrome RAM, explicit canvas release (`width = height = 0`).
  - `src/imaging/sampleDoc.ts` — Client-side shadowed sample document generator so first-time users can test trimming & shadow removal in 1 click.
- **Storage**: `src/db/storage.ts` — Native IndexedDB (`purescan-local-db`) storing original blobs, quads, filter settings, processed JPEGs, thumbnails, and active document title, with automatic in-memory fallback if private browsing blocks IndexedDB.
- **PDF Export**: `src/pdf/exporter.ts` — Lazy-loaded `pdf-lib` (`import('pdf-lib')` only on export, keeping initial JS bundle to ~102 KB gzipped). Sequential per-page JPEG encoding + direct `/DCTDecode` embedding, A4/Letter auto portrait/landscape orientation, Fit-to-Scan mode, selectable margins & DPI quality, direct browser download, and conditional native Web Share API (`navigator.share`).

---

## Commands
```powershell
npm install       # Install dependencies
npm run dev       # Local Vite dev server
npm test          # Run Vitest unit & PDF integration suites (14 tests)
npm run build     # TypeScript strict check (tsc -b) + Vite production build + PWA SW
npm run preview   # Serve production dist/ locally at http://127.0.0.1:4173
```

---

## Deploying to Vercel (Multi-User Production)
- `vercel.json` is preconfigured for static SPA routing and `Cache-Control: must-revalidate` on `/sw.js`.
- Push this repo to GitHub and import into Vercel (Framework Preset: **Vite**, Build Command: `npm run build`, Output Directory: `dist`).
- Every user's browser runs in its own isolated IndexedDB and Web Worker — multiple people can use the same deployed URL simultaneously with zero server cost and zero data shared between users.
- HTTPS is automatically provided by Vercel, which enables `getUserMedia` live camera and PWA home-screen installation on phones.

---

## Real-Phone Verification Checklist (After Deploying to HTTPS)
Verified locally on Windows desktop & emulated `390×844` mobile browser; test these 4 hardware-specific behaviors once live on Vercel:
1. Rear camera selection, autofocus, and torch toggle in `CameraView` on Android Chrome and iOS Safari.
2. Physical thumb-dragging feel and 2.6× magnifier loupe alignment on a real photographed paper with a harsh phone shadow.
3. Native `Share` button inside `ExportModal` sending a generated `.pdf` directly to WhatsApp / Google Drive / Files.
4. "Add to Home Screen" → Airplane Mode → verify offline scanning & PDF export.

---

## Potential v2 Ideas
- Lightweight pure-JS Sobel + quad detector to auto-suggest initial 4 corners (while keeping manual drag override).
- Multi-document history library in IndexedDB (switching between multiple saved scan folders).
- Optional client-side PDF merge or password/OCR pass if ever needed.
