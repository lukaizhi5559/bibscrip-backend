// JSON Schema for Electron Client ↔ Backend Communication
// Defines the interface between UI Automation Layer and Planning Engine

import { z } from 'zod';

// OCR Bounding Box Schema
export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  confidence: z.number().min(0).max(1)
});

// OCR Result Schema
export const OCRResultSchema = z.object({
  text: z.string(),
  boundingBoxes: z.array(BoundingBoxSchema),
  confidence: z.number().min(0).max(1),
  source: z.enum(['local', 'google', 'azure']),
  processingTime: z.number()
});

// App Context Schema
export const AppContextSchema = z.object({
  name: z.string(),
  windowTitle: z.string(),
  bundleId: z.string().optional(),
  processId: z.number().optional(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).optional()
});

// Screen Context Schema
export const ScreenContextSchema = z.object({
  width: z.number(),
  height: z.number(),
  scaleFactor: z.number(),
  colorDepth: z.number(),
  activeDisplay: z.number().optional()
});

// Request from Electron Client to Backend
export const ElectronRequestSchema = z.object({
  taskDescription: z.string(),
  screenshot: z.string(), // base64 encoded
  ocrResult: OCRResultSchema,
  appContext: AppContextSchema,
  screenContext: ScreenContextSchema,
  previousActions: z.array(z.object({
    action: z.string(),
    target: z.object({
      x: z.number(),
      y: z.number()
    }).optional(),
    timestamp: z.string(),
    success: z.boolean()
  })).optional(),
  sessionId: z.string().optional(),
  maxActions: z.number().default(5),
  timeout: z.number().default(30000)
});

// Action Target Schema
export const ActionTargetSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  element: z.string().optional(), // Element description
  confidence: z.number().min(0).max(1).optional()
});

// Action Schema (Response from Backend to Electron)
export const ActionSchema = z.object({
  action: z.enum([
    'click',
    'doubleClick', 
    'rightClick',
    'type',
    'keyPress',
    'scroll',
    'drag',
    'wait',
    'screenshot',
    'moveMouse',
    'focus',
    'switchApp'
  ]),
  target: ActionTargetSchema.optional(),
  text: z.string().optional(), // For type actions
  key: z.string().optional(), // For keyPress actions
  duration: z.number().optional(), // For wait actions
  direction: z.enum(['up', 'down', 'left', 'right']).optional(), // For scroll
  distance: z.number().optional(), // For scroll/drag
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  metadata: z.record(z.any()).optional()
});

// Response from Backend to Electron Client
export const BackendResponseSchema = z.object({
  success: z.boolean(),
  actions: z.array(ActionSchema),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  sessionId: z.string(),
  estimatedDuration: z.number().optional(),
  requiresVerification: z.boolean().default(false),
  error: z.string().optional(),
  metadata: z.object({
    llmProvider: z.string().optional(),
    processingTime: z.number(),
    tokensUsed: z.number().optional(),
    cacheHit: z.boolean().default(false)
  }).optional()
});

// Error Response Schema
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  errorCode: z.enum([
    'INVALID_REQUEST',
    'OCR_FAILED',
    'LLM_ERROR',
    'PLANNING_FAILED',
    'RATE_LIMITED',
    'AUTHENTICATION_FAILED',
    'INTERNAL_ERROR'
  ]),
  details: z.record(z.any()).optional(),
  sessionId: z.string().optional()
});

// Type exports for TypeScript
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type OCRResult = z.infer<typeof OCRResultSchema>;
export type AppContext = z.infer<typeof AppContextSchema>;
export type ScreenContext = z.infer<typeof ScreenContextSchema>;
export type ElectronRequest = z.infer<typeof ElectronRequestSchema>;
export type ActionTarget = z.infer<typeof ActionTargetSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type BackendResponse = z.infer<typeof BackendResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Validation helpers
export const validateElectronRequest = (data: unknown): ElectronRequest => {
  return ElectronRequestSchema.parse(data);
};

export const validateBackendResponse = (data: unknown): BackendResponse => {
  return BackendResponseSchema.parse(data);
};

export const createSuccessResponse = (
  actions: Action[],
  reasoning: string,
  confidence: number,
  sessionId: string,
  metadata?: any
): BackendResponse => {
  return {
    success: true,
    actions,
    reasoning,
    confidence,
    sessionId,
    requiresVerification: false,
    metadata: {
      processingTime: Date.now(),
      cacheHit: false,
      ...metadata
    }
  };
};

export const createErrorResponse = (
  error: string,
  errorCode: ErrorResponse['errorCode'],
  details?: any,
  sessionId?: string
): ErrorResponse => {
  return {
    success: false,
    error,
    errorCode,
    details,
    sessionId
  };
};
