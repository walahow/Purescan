/**
 * Generates a realistic tilted, unevenly-lit, harshly shadowed document photo
 * completely on-device using an offscreen HTML5 Canvas. Lets first-time visitors
 * test 4-corner perspective trimming and Pure shadow removal in one click.
 */
export async function generateSampleShadowedDocument(variant: 1 | 2 = 1): Promise<Blob> {
  const w = 840;
  const h = 1100;

  // 1. Render a clean high-contrast document onto a flat offscreen canvas first
  const docW = 660;
  const docH = 920;
  const docCanvas = document.createElement('canvas');
  docCanvas.width = docW;
  docCanvas.height = docH;
  const dctx = docCanvas.getContext('2d');
  if (!dctx) throw new Error('Canvas unavailable.');

  // Slightly warm paper base
  dctx.fillStyle = '#f3eee0';
  dctx.fillRect(0, 0, docW, docH);

  // Header
  dctx.fillStyle = '#18181b';
  dctx.font = 'bold 26px Inter, system-ui, sans-serif';
  dctx.fillText(
    variant === 1 ? 'DOCUMENT VERIFICATION FORM' : 'APPENDIX — PROJECT SUMMARY',
    52,
    82
  );
  dctx.font = '13px monospace';
  dctx.fillStyle = '#52525b';
  dctx.fillText(
    variant === 1
      ? 'REF_NO: DOC-2026-0418   //   PAGE 01 OF 02'
      : 'REF_NO: DOC-2026-0418   //   PAGE 02 OF 02',
    52,
    108
  );
  dctx.fillStyle = '#27272a';
  dctx.fillRect(52, 124, docW - 104, 2.5);

  // Highlighted line behind text
  dctx.fillStyle = '#fef08a';
  dctx.fillRect(50, 224, 415, 24);

  // Crisp realistic printed body lines
  const lines =
    variant === 1
      ? [
          '1. SUBMISSION OVERVIEW',
          'This sample sheet simulates a physical paper photographed on a wooden',
          'desk under warm room lighting with a harsh phone shadow across the page.',
          'Drag the four green handles onto the paper corners to flatten perspective,',
          'then compare Pure Color vs Pure B&W to watch the shadow disappear cleanly.',
          '',
          '2. DOCUMENT CHECKLIST',
          '• Perspective correction via 3x3 inverse homography (bilinear sampling)',
          '• Illumination normalization via border-padded morphological closing',
          '• 100% client-side execution inside a dedicated Web Worker (zero upload)',
          '• Multi-page PDF assembly via pdf-lib with A4 auto-orientation',
        ]
      : [
          '3. MULTI-PAGE EXPORT NOTES',
          'Multiple scanned sheets can be reordered, rotated, re-cropped, or batch',
          'filtered right inside your local workspace before exporting to PDF.',
          'Every page is persisted in your browser IndexedDB storage so reloading',
          'the tab never loses work even while switching to your phone camera.',
          '',
          '4. PRIVACY & OFFLINE GUARANTEE',
          '• No account login, no cloud server, no video ads, no PDF watermarks',
          '• Installable as a Progressive Web App (PWA) for full offline scanning',
        ];

  let y = 172;
  for (const line of lines) {
    if (!line) {
      y += 16;
      continue;
    }
    const isHeading = /^\d\./.test(line);
    dctx.font = isHeading
      ? 'bold 16px Inter, system-ui, sans-serif'
      : '15px Inter, system-ui, sans-serif';
    dctx.fillStyle = isHeading ? '#18181b' : '#27272a';
    dctx.fillText(line, 52, y);
    y += isHeading ? 28 : 26;
  }

  // Table block
  const ty = 520;
  dctx.strokeStyle = '#27272a';
  dctx.lineWidth = 1.8;
  dctx.strokeRect(52, ty, docW - 104, 150);
  dctx.beginPath();
  dctx.moveTo(52, ty + 42);
  dctx.lineTo(docW - 52, ty + 42);
  dctx.moveTo(52, ty + 96);
  dctx.lineTo(docW - 52, ty + 96);
  dctx.moveTo(270, ty);
  dctx.lineTo(270, ty + 150);
  dctx.stroke();

  dctx.font = 'bold 13px monospace';
  dctx.fillStyle = '#18181b';
  dctx.fillText('FIELD', 68, ty + 27);
  dctx.fillText('VALUE / VERIFICATION', 286, ty + 27);
  dctx.font = '14px Inter, system-ui, sans-serif';
  dctx.fillText('Processing Mode', 68, ty + 74);
  dctx.fillText('On-Device Web Worker (0 KB uploaded)', 286, ty + 74);
  dctx.fillText('Target Format', 68, ty + 128);
  dctx.fillText('A4 Multi-Page PDF (Clean White Background)', 286, ty + 128);

  // Blue handwritten signature (bottom-left)
  dctx.strokeStyle = '#1d4ed8';
  dctx.lineWidth = 3.2;
  dctx.lineCap = 'round';
  dctx.beginPath();
  for (let i = 0; i <= 150; i += 3) {
    const sx = 90 + i;
    const sy = 790 + Math.sin(i * 0.09) * 18 + Math.cos(i * 0.21) * 7 - i * 0.08;
    if (i === 0) dctx.moveTo(sx, sy);
    else dctx.lineTo(sx, sy);
  }
  dctx.stroke();
  dctx.font = '12px monospace';
  dctx.fillStyle = '#52525b';
  dctx.fillText('AUTHORIZED SIGNATURE', 90, 840);

  // Red official stamp (bottom-right)
  dctx.save();
  dctx.translate(490, 785);
  dctx.rotate(-0.18);
  dctx.strokeStyle = '#dc2626';
  dctx.lineWidth = 3.5;
  dctx.beginPath();
  dctx.arc(0, 0, 50, 0, Math.PI * 2);
  dctx.stroke();
  dctx.lineWidth = 1.5;
  dctx.beginPath();
  dctx.arc(0, 0, 40, 0, Math.PI * 2);
  dctx.stroke();
  dctx.fillStyle = '#dc2626';
  dctx.font = 'bold 13px monospace';
  dctx.textAlign = 'center';
  dctx.fillText('VERIFIED', 0, -4);
  dctx.font = 'bold 11px monospace';
  dctx.fillText('LOCAL SCAN', 0, 14);
  dctx.restore();

  // 2. Composite tilted paper onto a dark wood desk canvas
  const scene = document.createElement('canvas');
  scene.width = w;
  scene.height = h;
  const ctx = scene.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');

  // Wood desk surface
  const deskGrad = ctx.createLinearGradient(0, 0, w, h);
  deskGrad.addColorStop(0, '#5a4332');
  deskGrad.addColorStop(1, '#3a2a1e');
  ctx.fillStyle = deskGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  for (let gx = 0; gx < w; gx += 22) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.bezierCurveTo(gx + 10, h * 0.33, gx - 10, h * 0.66, gx + 4, h);
    ctx.stroke();
  }

  // Draw slightly tilted sheet with subtle drop shadow
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(variant === 1 ? -0.055 : 0.045);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = 10;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(docCanvas, -docW / 2, -docH / 2, docW, docH);
  ctx.restore();

  // 3. Cast harsh diagonal phone/hand shadow + warm ambient light gradient
  const shadowGrad =
    variant === 1
      ? ctx.createLinearGradient(w * 0.32, h * 0.38, w * 0.62, h * 0.66)
      : ctx.createLinearGradient(w * 0.68, h * 0.32, w * 0.36, h * 0.65);
  shadowGrad.addColorStop(0, 'rgba(18, 22, 34, 0)');
  shadowGrad.addColorStop(0.45, 'rgba(18, 22, 34, 0.08)');
  shadowGrad.addColorStop(0.58, 'rgba(18, 22, 34, 0.56)');
  shadowGrad.addColorStop(1, 'rgba(14, 18, 30, 0.60)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    scene.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode sample document.'))),
      'image/jpeg',
      0.92
    );
  });

  docCanvas.width = 0;
  docCanvas.height = 0;
  scene.width = 0;
  scene.height = 0;
  return blob;
}
