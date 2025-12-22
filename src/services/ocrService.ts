import vision, { ImageAnnotatorClient } from '@google-cloud/vision';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import axios from 'axios';

let visionClient: ImageAnnotatorClient | null = null;
let visionApiKey: string | null = null;

// Initialize Google Cloud Vision client
if (process.env.GOOGLE_CLOUD_VISION_KEY) {
  try {
    // Check if it's a file path (contains .json or starts with /)
    if (process.env.GOOGLE_CLOUD_VISION_KEY.includes('.json') || 
        process.env.GOOGLE_CLOUD_VISION_KEY.startsWith('/')) {
      // It's a JSON credentials file path
      if (fs.existsSync(process.env.GOOGLE_CLOUD_VISION_KEY)) {
        visionClient = new vision.ImageAnnotatorClient({
          keyFilename: process.env.GOOGLE_CLOUD_VISION_KEY,
        });
        logger.info('✅ [OCR] Google Cloud Vision initialized with credentials file');
      } else {
        logger.warn('⚠️ [OCR] Google Cloud Vision credentials file not found', {
          path: process.env.GOOGLE_CLOUD_VISION_KEY,
        });
      }
    } else {
      // It's an API key - use REST API
      visionApiKey = process.env.GOOGLE_CLOUD_VISION_KEY;
      logger.info('✅ [OCR] Google Cloud Vision initialized with API key');
    }
  } catch (error: any) {
    logger.error('❌ [OCR] Failed to initialize Google Cloud Vision', {
      error: error.message,
    });
  }
}

export interface OCRResult {
  text: string;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  confidence: number;
}

export interface ObjectDetectionResult {
  name: string;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  confidence: number;
}

export interface LogoDetectionResult {
  name: string;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  confidence: number;
}

export class OCRService {
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = !!visionClient || !!visionApiKey;
    if (this.isAvailable) {
      logger.info('✅ [OCR] Google Cloud Vision initialized');
    } else {
      logger.warn('⚠️ [OCR] Google Cloud Vision not configured (set GOOGLE_CLOUD_VISION_KEY)');
    }
  }

  async detectText(screenshot: string): Promise<OCRResult[]> {
    if (!this.isAvailable) {
      logger.debug('[OCR] Service not available, skipping');
      return [];
    }

    try {
      let detections: any[] = [];

      if (visionClient) {
        // Use client library with credentials file
        const [result] = await visionClient.textDetection({
          image: { content: Buffer.from(screenshot, 'base64') },
        });
        detections = result.textAnnotations || [];
      } else if (visionApiKey) {
        // Use REST API with API key
        const response = await axios.post(
          `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
          {
            requests: [
              {
                image: { content: screenshot },
                features: [{ type: 'TEXT_DETECTION' }],
              },
            ],
          }
        );

        detections = response.data.responses[0]?.textAnnotations || [];
      }

      const words = detections.slice(1);

      const ocrResults: OCRResult[] = words
        .filter((detection: any) => {
          const text = detection.description || '';
          return text.length >= 2;
        })
        .map((detection: any) => {
          const vertices = detection.boundingPoly?.vertices || [];
          
          return {
            text: detection.description || '',
            bbox: {
              x1: vertices[0]?.x || 0,
              y1: vertices[0]?.y || 0,
              x2: vertices[2]?.x || 0,
              y2: vertices[2]?.y || 0,
            },
            confidence: detection.confidence || 0.9,
          };
        });

      logger.info('✅ [OCR] Text detected', {
        count: ocrResults.length,
        method: visionClient ? 'credentials' : 'api_key',
      });

      return ocrResults;
    } catch (error: any) {
      logger.error('❌ [OCR] Detection failed', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return [];
    }
  }

  findTextMatch(
    results: OCRResult[],
    description: string
  ): OCRResult | null {
    if (results.length === 0) return null;

    const descLower = description.toLowerCase();
    const keywords = descLower.split(/\s+/).filter(w => w.length > 2);

    const fullText = results.map(r => r.text).join(' ').toLowerCase();
    if (fullText.includes(descLower)) {
      for (let i = 0; i < results.length; i++) {
        const phrase = results.slice(i, i + keywords.length)
          .map(r => r.text)
          .join(' ')
          .toLowerCase();
        
        if (phrase.includes(descLower)) {
          const matchedWords = results.slice(i, i + keywords.length);
          return this.mergeBoundingBoxes(matchedWords);
        }
      }
    }

    let bestMatch: OCRResult | null = null;
    let bestScore = 0;

    for (const result of results) {
      const textLower = result.text.toLowerCase();
      const matchCount = keywords.filter(kw => textLower.includes(kw)).length;
      const score = (matchCount / keywords.length) * result.confidence;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    return bestScore > 0.5 ? bestMatch : null;
  }

  private mergeBoundingBoxes(results: OCRResult[]): OCRResult {
    const x1 = Math.min(...results.map(r => r.bbox.x1));
    const y1 = Math.min(...results.map(r => r.bbox.y1));
    const x2 = Math.max(...results.map(r => r.bbox.x2));
    const y2 = Math.max(...results.map(r => r.bbox.y2));

    return {
      text: results.map(r => r.text).join(' '),
      bbox: { x1, y1, x2, y2 },
      confidence: Math.min(...results.map(r => r.confidence)),
    };
  }

  getCenter(bbox: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number } {
    return {
      x: Math.round((bbox.x1 + bbox.x2) / 2),
      y: Math.round((bbox.y1 + bbox.y2) / 2),
    };
  }

  async detectObjects(screenshot: string, imageWidth?: number, imageHeight?: number): Promise<ObjectDetectionResult[]> {
    if (!this.isAvailable) {
      logger.debug('[OBJECT-DETECTION] Service not available, skipping');
      return [];
    }

    try {
      let annotations: any[] = [];
      let width = imageWidth || 1920; // Default width
      let height = imageHeight || 1080; // Default height

      // Get image dimensions from base64 if not provided
      if (!imageWidth || !imageHeight) {
        try {
          const buffer = Buffer.from(screenshot, 'base64');
          const sharp = require('sharp');
          const metadata = await sharp(buffer).metadata();
          width = metadata.width || width;
          height = metadata.height || height;
        } catch (e) {
          logger.warn('[OBJECT-DETECTION] Could not get image dimensions, using defaults');
        }
      }

      if (visionClient !== null) {
        // Use client library with credentials file
        // @ts-ignore - objectLocalization exists but TypeScript definitions may be incomplete
        const [result] = await visionClient.objectLocalization({
          image: { content: Buffer.from(screenshot, 'base64') },
        });
        annotations = result.localizedObjectAnnotations || [];
      } else if (visionApiKey !== null) {
        // Use REST API with API key
        const response = await axios.post(
          `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
          {
            requests: [
              {
                image: { content: screenshot },
                features: [{ type: 'OBJECT_LOCALIZATION' }],
              },
            ],
          }
        );

        annotations = response.data.responses[0]?.localizedObjectAnnotations || [];
      }

      const objectResults: ObjectDetectionResult[] = annotations
        .filter((obj: any) => obj.score >= 0.5) // Only confident detections
        .map((obj: any) => {
          const vertices = obj.boundingPoly?.normalizedVertices || [];
          
          // Convert normalized coordinates (0-1) to pixel coordinates
          return {
            name: obj.name,
            bbox: {
              x1: Math.round((vertices[0]?.x || 0) * width),
              y1: Math.round((vertices[0]?.y || 0) * height),
              x2: Math.round((vertices[2]?.x || 1) * width),
              y2: Math.round((vertices[2]?.y || 1) * height),
            },
            confidence: obj.score || 0.5,
          };
        });

      logger.info('✅ [OBJECT-DETECTION] Objects detected', {
        count: objectResults.length,
        imageSize: `${width}x${height}`,
        method: visionClient ? 'credentials' : 'api_key',
      });

      return objectResults;
    } catch (error: any) {
      logger.error('❌ [OBJECT-DETECTION] Detection failed', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return [];
    }
  }

  async detectLogos(screenshot: string, imageWidth?: number, imageHeight?: number): Promise<LogoDetectionResult[]> {
    if (!this.isAvailable) {
      logger.debug('[LOGO-DETECTION] Service not available, skipping');
      return [];
    }

    try {
      let annotations: any[] = [];
      let width = imageWidth || 1920;
      let height = imageHeight || 1080;

      // Get image dimensions from base64 if not provided
      if (!imageWidth || !imageHeight) {
        try {
          const buffer = Buffer.from(screenshot, 'base64');
          const sharp = require('sharp');
          const metadata = await sharp(buffer).metadata();
          width = metadata.width || width;
          height = metadata.height || height;
        } catch (e) {
          logger.warn('[LOGO-DETECTION] Could not get image dimensions, using defaults');
        }
      }

      if (visionClient !== null) {
        // Use client library with credentials file
        // @ts-ignore - logoDetection exists but TypeScript definitions may be incomplete
        const [result] = await visionClient.logoDetection({
          image: { content: Buffer.from(screenshot, 'base64') },
        });
        annotations = result.logoAnnotations || [];
      } else if (visionApiKey !== null) {
        // Use REST API with API key
        const response = await axios.post(
          `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
          {
            requests: [
              {
                image: { content: screenshot },
                features: [{ type: 'LOGO_DETECTION' }],
              },
            ],
          }
        );

        annotations = response.data.responses[0]?.logoAnnotations || [];
      }

      const logoResults: LogoDetectionResult[] = annotations
        .filter((logo: any) => logo.score >= 0.5) // Only confident detections
        .map((logo: any) => {
          const vertices = logo.boundingPoly?.vertices || [];
          
          // Vertices are in pixel coordinates for logo detection
          return {
            name: logo.description,
            bbox: {
              x1: vertices[0]?.x || 0,
              y1: vertices[0]?.y || 0,
              x2: vertices[2]?.x || 0,
              y2: vertices[2]?.y || 0,
            },
            confidence: logo.score || 0.5,
          };
        });

      logger.info('✅ [LOGO-DETECTION] Logos detected', {
        count: logoResults.length,
        imageSize: `${width}x${height}`,
        method: visionClient ? 'credentials' : 'api_key',
      });

      return logoResults;
    } catch (error: any) {
      logger.error('❌ [LOGO-DETECTION] Detection failed', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return [];
    }
  }

  isServiceAvailable(): boolean {
    return this.isAvailable;
  }
}

export const ocrService = new OCRService();
