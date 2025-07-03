import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import bibleRouter from './bible';
import vectorRouter from './vector';
import cacheRouter from './cache';
import generateRouter from './generate';
import askRouter from './ask';
import youtubeRouter from './youtube';
import authRouter from './auth';
import bibliographyRouter from './bibliography';
import visualAgentRouter from './visualAgent';
import fastVisionAgentRouter from './fastVisionAgent';
import integrationRouter from './integration';
import analyticsRouter from './analytics';
// Import other route modules directly instead of using dynamic imports

const router = Router();

// Get the absolute path to the current directory
const apiDir = __dirname;

/**
 * @swagger
 * /api:
 *   get:
 *     summary: Get API overview and available endpoints
 *     tags: [API Overview]
 *     description: Returns a comprehensive list of all available API endpoints with descriptions
 *     responses:
 *       200:
 *         description: API overview retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: "Bibscrip Backend API"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 description:
 *                   type: string
 *                   example: "Backend API for Bible verse retrieval and processing"
 *                 endpoints:
 *                   type: object
 *                   description: Available API endpoint groups
 *                 documentation:
 *                   type: object
 *                   properties:
 *                     swagger:
 *                       type: string
 *                       example: "/api-docs"
 */
router.get('/', (req, res) => {
  res.json({
    name: 'Bibscrip Backend API',
    version: '1.0.0',
    description: 'Backend API for Bible verse retrieval and processing',
    endpoints: {
      bible: {
        path: '/api/bible',
        description: 'Bible verse and translation API',
        endpoints: [
          'GET /api/bible/verse - Get a single Bible verse',
          'GET /api/bible/passage - Get a Bible passage (multiple verses)',
          'GET /api/bible/chapter/{book}/{chapter} - Get entire chapter',
          'GET /api/bible/translations - Get available translations',
          'GET /api/bible/translations/abbreviations - Get translation abbreviations'
        ]
      },
      auth: {
        path: '/api/auth',
        description: 'JWT and API key authentication endpoints',
        endpoints: [
          'POST /api/auth/token - Generate JWT token',
          'POST /api/auth/refresh - Refresh JWT token',
          'POST /api/auth/validate - Validate API key'
        ]
      },
      bibliography: {
        path: '/api/bibliography',
        description: 'Bibliography management and citation API',
        endpoints: [
          'GET /api/bibliography - List all bibliography entries',
          'POST /api/bibliography - Create new bibliography entry',
          'GET /api/bibliography/{id} - Get bibliography entry by ID',
          'PUT /api/bibliography/{id} - Update bibliography entry',
          'DELETE /api/bibliography/{id} - Delete bibliography entry',
          'GET /api/bibliography/search - Search bibliography entries',
          'GET /api/bibliography/{id}/citation - Generate citation'
        ]
      },
      analytics: {
        path: '/api/analytics',
        description: 'Analytics tracking and reporting',
        endpoints: [
          'POST /api/analytics - Record analytics event',
          'GET /api/analytics - Get analytics summary'
        ]
      },
      ask: {
        path: '/api/ask',
        description: 'AI-powered Bible verse queries',
        endpoints: [
          'POST /api/ask - Ask AI-powered Bible questions'
        ]
      },
      cache: {
        path: '/api/cache',
        description: 'Cache management operations',
        endpoints: [
          'GET /api/cache/{key} - Get cached item',
          'POST /api/cache/{key} - Store cache item',
          'DELETE /api/cache/{key} - Delete cache item'
        ]
      },
      generate: {
        path: '/api/generate',
        description: 'AI text generation',
        endpoints: [
          'POST /api/generate - Generate AI text content'
        ]
      },
      integration: {
        path: '/api/integration',
        description: 'ThinkDrop AI integration services',
        endpoints: [
          'POST /api/integration/services/start - Start integration services',
          'POST /api/integration/services/stop - Stop integration services',
          'GET /api/integration/services/status - Get service status',
          'GET /api/integration/ipc/clients - Get IPC clients',
          'POST /api/integration/ipc/send - Send IPC message',
          'POST /api/integration/ipc/broadcast - Broadcast IPC message',
          'POST /api/integration/visual-agent/workflow - Execute visual agent workflow'
        ]
      },
      vector: {
        path: '/api/vector',
        description: 'Vector database operations',
        endpoints: [
          'POST /api/vector/store - Store document in vector DB',
          'POST /api/vector/batch - Batch store documents',
          'POST /api/vector/search - Semantic search',
          'DELETE /api/vector/{id} - Delete document',
          'DELETE /api/vector/batch - Delete multiple documents',
          'DELETE /api/vector/namespace/{namespace} - Clear namespace',
          'GET /api/vector/status - Get vector DB status'
        ]
      },
      'visual-agent': {
        path: '/api/visual-agent',
        description: 'Desktop automation and visual agent workflow',
        endpoints: [
          'GET /api/visual-agent/status - Get visual agent status',
          'POST /api/visual-agent/screenshot - Take screenshot',
          'POST /api/visual-agent/analyze - Analyze screenshot',
          'POST /api/visual-agent/plan - Generate action plan',
          'POST /api/visual-agent/execute - Execute actions',
          'POST /api/visual-agent/execute-prompt - Execute with prompt',
          'POST /api/visual-agent/emergency-stop - Emergency stop',
          'GET /api/visual-agent/mouse-position - Get mouse position',
          'GET /api/visual-agent/screen-dimensions - Get screen dimensions'
        ]
      },

      youtube: {
        path: '/api/youtube',
        description: 'YouTube API proxy',
        endpoints: [
          'GET /api/youtube - Search YouTube videos',
          'GET /api/youtube/video/{id} - Get video details'
        ]
      }
    },
    documentation: {
      swagger: '/api-docs',
      baseUrl: process.env.NODE_ENV === 'production' 
        ? (process.env.API_BASE_URL || 'https://api.bibscrip.com') 
        : 'http://localhost:4000'
    }
  });
});

// Mount routers
router.use('/bible', bibleRouter);
router.use('/vector', vectorRouter);
router.use('/cache', cacheRouter);
router.use('/generate', generateRouter);
router.use('/ask', askRouter);
router.use('/youtube', youtubeRouter);
router.use('/auth', authRouter);
router.use('/bibliography', bibliographyRouter);
router.use('/visual-agent', visualAgentRouter);
router.use('/fast-vision-agent', fastVisionAgentRouter);
router.use('/integration', integrationRouter);
router.use('/analytics', analyticsRouter);

// All routers are explicitly imported and mounted above
// No need for dynamic mounting as it can cause route conflicts

export default router;
