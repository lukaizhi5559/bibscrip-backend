import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import http from 'http';
import WebSocket from 'ws';
import router from './api';
import automationAnalyticsRouter from './api/automationAnalytics';
import aiMemoryRouter from './routes/aiMemory';
import smartPromptRouter from './routes/smartPrompt';
import intentRouter from './api/intentRoutes';
import { logger } from './utils/logger';
import { vectorDbService } from './services/vectorDbService';
import { fetchBibleIds } from './utils/bible';
import { setupStreamingWebSocket } from './websocket';
import { handleComputerUseWebSocket } from './api/computerUseWebSocket';
import { intentWebSocketServer } from './api/intentWebSocket';
import { omniParserWarmup } from './services/omniParserWarmup';

// Load environment variables from .env file
dotenv.config();

const app = express();

// Configure CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
  process.env.ALLOWED_ORIGINS.split(',') : 
  ['http://localhost:3000']; // Default to frontend dev server

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `CORS policy doesn't allow access from origin ${origin}`;
      return callback(new Error(msg), false);
    }
    
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Request logging middleware
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// JSON body parser with increased limit for screenshot uploads
// Default is 100kb, we need more for base64 encoded images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Bibscrip Backend API',
      version: '1.0.0',
      description: 'Backend API for Bible verse retrieval and processing',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? (process.env.API_BASE_URL || 'https://api.bibscrip.com') 
          : 'http://localhost:4000',
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
      },
    ],
    components: {
      schemas: {
        BibleVerse: {
          type: 'object',
          properties: {
            reference: { type: 'string', example: 'John 3:16' },
            text: { type: 'string', example: 'For God so loved the world...' },
            translation: { type: 'string', example: 'ESV' },
            translationName: { type: 'string', example: 'English Standard Version' },
            book: { type: 'string', example: 'John' },
            chapter: { type: 'number', example: 3 },
            verse: { type: 'number', example: 16 },
            copyright: { type: 'string' },
          },
        },
        TranslationInfo: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '55212e3cf5d04d49-01' },
            name: { type: 'string', example: 'English Standard Version' },
            abbreviation: { type: 'string', example: 'ESV' },
            language: { type: 'string', example: 'eng' },
            description: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/api/*.ts'], // Path to the API routes files
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Swagger UI setup
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Bibscrip API Documentation',
}));

// API root endpoint is now handled by the comprehensive API router in /src/api/index.ts

// Mount API routes
app.use('/api', router);
app.use('/api/automation-analytics', automationAnalyticsRouter);
app.use('/api/memory', aiMemoryRouter);
app.use('/api/smart-prompt', smartPromptRouter);
app.use('/api/intent', intentRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Initialize services before starting the server
async function initializeServices() {
  try {
    // Initialize vector database service with fallback support
    await vectorDbService.initialize();
    if (vectorDbService.isAvailable()) {
      logger.info('Vector database service initialized successfully');
    } else {
      logger.warn('Vector database service running in fallback mode - some features may be limited');
    }

    // Initialize Bible API by fetching all available translations
    await fetchBibleIds();
    logger.info('Bible API IDs initialized');

    // UI Indexer Daemon removed - desktop automation moved to Electron client

    // Start OmniParser warmup service to prevent cold boots
    omniParserWarmup.start();
    
    return true;
  } catch (error) {
    logger.error('Failed to initialize services', { error });
    return false;
  }
}

// Start the server after initializing services
const PORT = process.env.PORT || 4000;
initializeServices().then(() => {
  // Create HTTP server
  const server = http.createServer(app);
  
  // Setup WebSocket streaming server (non-disruptive to REST APIs)
  const wsServer = setupStreamingWebSocket(server);
  
  // Setup Computer Use WebSocket server with noServer option (DEPRECATED - use /intent-use)
  const computerUseWss = new WebSocket.Server({ 
    noServer: true
  });
  
  computerUseWss.on('connection', (ws, req) => {
    logger.info('🌐 [COMPUTER-USE] New WebSocket connection (DEPRECATED)');
    handleComputerUseWebSocket(ws, req);
  });
  
  computerUseWss.on('error', (error) => {
    logger.error('❌ [COMPUTER-USE] WebSocket server error:', error);
  });
  
  // Setup Intent WebSocket server (NEW - intent-driven automation)
  intentWebSocketServer.initialize(server);
  
  // Handle upgrade requests - route to appropriate WebSocket server
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    
    logger.info(`🔄 [WEBSOCKET] Upgrade request for path: ${pathname}`);
    
    if (pathname === '/intent-use') {
      logger.info('🎯 [INTENT] Routing to Intent WebSocket (NEW)');
      // Intent WebSocket handles its own upgrade via ws library
      return;
    } else if (pathname === '/computer-use') {
      logger.info('🌐 [COMPUTER-USE] Routing to Computer Use WebSocket (DEPRECATED)');
      computerUseWss.handleUpgrade(request, socket, head, (ws) => {
        computerUseWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/stream') {
      logger.info('📡 [STREAMING] Routing to Streaming WebSocket');
      // Let the streaming server handle it - it's already set up with noServer
      wsServer.handleUpgrade(request, socket, head);
    } else {
      logger.warn(`⚠️ [WEBSOCKET] Unknown WebSocket path: ${pathname}`);
      socket.destroy();
    }
  });
  
  // Start server
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    logger.info(`WebSocket streaming server available at ws://localhost:${PORT}/ws/stream`);
    logger.info(`Computer Use WebSocket server available at ws://localhost:${PORT}/computer-use`);
    logger.info(`REST APIs remain unchanged and fully functional`);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    omniParserWarmup.stop();
    wsServer.shutdown();
    computerUseWss.close(() => {
      logger.info('Computer Use WebSocket server closed');
    });
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
  
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    omniParserWarmup.stop();
    wsServer.shutdown();
    computerUseWss.close(() => {
      logger.info('Computer Use WebSocket server closed');
    });
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
});
