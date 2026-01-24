/**
 * Screenshot Compression Utility
 * 
 * Compresses screenshots before sending to LLM to reduce:
 * - Upload time
 * - LLM processing time
 * - API costs
 * 
 * Compatible with OmniParser and all vision APIs
 */

import sharp from 'sharp';
import { logger } from './logger';

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

const DEFAULT_OPTIONS: CompressionOptions = {
  maxWidth: 1280,
  maxHeight: 720,
  quality: 85,
  format: 'jpeg',
};

/**
 * Compress screenshot to reduce size while maintaining quality
 * 
 * @param base64Screenshot - Base64 encoded screenshot
 * @param options - Compression options
 * @returns Compressed base64 screenshot
 */
export async function compressScreenshot(
  base64Screenshot: string,
  options: CompressionOptions = {}
): Promise<{
  base64: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Remove data URL prefix if present
    let base64Data = base64Screenshot;
    if (base64Screenshot.includes('data:image')) {
      const base64Match = base64Screenshot.match(/^data:image\/[a-z]+;base64,(.+)$/);
      if (base64Match && base64Match[1]) {
        base64Data = base64Match[1];
      }
    }

    const originalSize = base64Data.length;
    const buffer = Buffer.from(base64Data, 'base64');

    // Compress using sharp
    let sharpInstance = sharp(buffer);

    // Resize if dimensions exceed max
    const metadata = await sharpInstance.metadata();
    if (metadata.width && metadata.height) {
      const needsResize = 
        metadata.width > (opts.maxWidth || Infinity) || 
        metadata.height > (opts.maxHeight || Infinity);

      if (needsResize) {
        sharpInstance = sharpInstance.resize(opts.maxWidth, opts.maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
    }

    // Convert to target format
    let compressedBuffer: Buffer;
    let mimeType: string;

    switch (opts.format) {
      case 'jpeg':
        compressedBuffer = await sharpInstance
          .jpeg({ quality: opts.quality, mozjpeg: true })
          .toBuffer();
        mimeType = 'image/jpeg';
        break;
      case 'webp':
        compressedBuffer = await sharpInstance
          .webp({ quality: opts.quality })
          .toBuffer();
        mimeType = 'image/webp';
        break;
      case 'png':
        compressedBuffer = await sharpInstance
          .png({ compressionLevel: 9 })
          .toBuffer();
        mimeType = 'image/png';
        break;
      default:
        throw new Error(`Unsupported format: ${opts.format}`);
    }

    const compressedBase64 = compressedBuffer.toString('base64');
    const compressedSize = compressedBase64.length;
    const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
    const latencyMs = Date.now() - startTime;

    logger.info('Screenshot compressed', {
      originalSize,
      compressedSize,
      compressionRatio: `${compressionRatio.toFixed(1)}%`,
      format: opts.format,
      quality: opts.quality,
      latencyMs,
    });

    return {
      base64: compressedBase64,
      mimeType,
      originalSize,
      compressedSize,
      compressionRatio,
    };
  } catch (error: any) {
    logger.error('Screenshot compression failed', {
      error: error.message,
    });

    // Return original if compression fails
    return {
      base64: base64Screenshot,
      mimeType: 'image/png',
      originalSize: base64Screenshot.length,
      compressedSize: base64Screenshot.length,
      compressionRatio: 0,
    };
  }
}

/**
 * Check if screenshot should be compressed
 * Skip compression for small screenshots (< 500KB)
 */
export function shouldCompress(base64Screenshot: string): boolean {
  const sizeBytes = base64Screenshot.length;
  const sizeKB = sizeBytes / 1024;
  return sizeKB > 500; // Only compress if > 500KB
}
