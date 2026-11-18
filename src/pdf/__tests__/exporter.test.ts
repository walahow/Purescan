import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  buildPdfFromJpegs,
  formatBytes,
  PAGE_DIMENSIONS_PT,
  sanitizeFilename,
} from '../exporter';

// Minimal valid 16x24 portrait and 24x16 landscape JPEG fixtures
const PORTRAIT_JPG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigD/9k=';

const LANDSCAPE_JPG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigD/9k=';

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('PDF export utilities and pdf-lib assembly', () => {
  it('sanitizes filenames and guarantees .pdf extension', () => {
    expect(sanitizeFilename('Surat Pengantar: KRS/2026')).toBe('Surat_Pengantar_KRS_2026.pdf');
    expect(sanitizeFilename('scan.PDF')).toBe('scan.PDF');
    expect(sanitizeFilename('   ...   ')).toBe('PureScan_Document.pdf');
  });

  it('formats byte sizes cleanly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
  });

  it('builds a valid multi-page A4 PDF with auto portrait/landscape orientation', async () => {
    const portrait = fromBase64(PORTRAIT_JPG_B64);
    const landscape = fromBase64(LANDSCAPE_JPG_B64);

    const bytes = await buildPdfFromJpegs(
      [{ bytes: portrait }, { bytes: landscape }],
      { pageSize: 'a4', margin: 'small', title: 'Test Multi-Page Scan' }
    );

    expect(bytes.byteLength).toBeGreaterThan(500);
    // Verify PDF header magic "%PDF-"
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii');
    expect(header).toBe('%PDF-');

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getTitle()).toBe('Test Multi-Page Scan');

    const p0 = loaded.getPage(0).getSize();
    const p1 = loaded.getPage(1).getSize();

    // Page 0: portrait A4
    expect(p0.width).toBeCloseTo(PAGE_DIMENSIONS_PT.a4.width, 1);
    expect(p0.height).toBeCloseTo(PAGE_DIMENSIONS_PT.a4.height, 1);

    // Page 1: auto-rotated landscape A4
    expect(p1.width).toBeCloseTo(PAGE_DIMENSIONS_PT.a4.height, 1);
    expect(p1.height).toBeCloseTo(PAGE_DIMENSIONS_PT.a4.width, 1);
  });

  it('supports fit-to-scan sizing preserving exact image aspect ratio', async () => {
    const portrait = fromBase64(PORTRAIT_JPG_B64); // 16x24 -> aspect 2:3
    const bytes = await buildPdfFromJpegs([{ bytes: portrait }], {
      pageSize: 'fit',
      margin: 'none',
    });

    const loaded = await PDFDocument.load(bytes);
    const p0 = loaded.getPage(0).getSize();
    expect(p0.width / p0.height).toBeCloseTo(16 / 24, 3);
  });

  it('throws cleanly when given zero pages', async () => {
    await expect(buildPdfFromJpegs([], { pageSize: 'a4', margin: 'none' })).rejects.toThrow();
  });
});
