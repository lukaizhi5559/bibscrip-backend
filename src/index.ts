import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import router from './api';
import { logger } from './utils/logger';
import { vectorDbService } from './services/vectorDbService';
import { fetchBibleIds } from './utils/bible';

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
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging middleware
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// JSON body parser
app.use(express.json());

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
            translation: { type: 'string', example: 'NIV' },
            translationName: { type: 'string', example: 'New International Version' },
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
            name: { type: 'string', example: 'New International Version' },
            abbreviation: { type: 'string', example: 'NIV' },
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

// API root endpoint with documentation links
app.get('/api', (req, res) => {
  res.json({
    name: 'Bibscrip Backend API',
    version: '1.0.0',
    description: 'Backend API for Bible verse retrieval and processing',
    endpoints: {
      bible: {
        description: 'Bible API endpoints',
        endpoints: [
          { path: '/api/bible/verse', method: 'GET', description: 'Get a Bible verse by reference' },
          { path: '/api/bible/passage', method: 'GET', description: 'Get a Bible passage (multiple verses)' },
          { path: '/api/bible/chapter/:book/:chapter', method: 'GET', description: 'Get an entire Bible chapter' },
          { path: '/api/bible/chapters/:book/:startChapter/:endChapter', method: 'GET', description: 'Get multiple Bible chapters' },
          { path: '/api/bible/translations', method: 'GET', description: 'Get detailed information about available Bible translations' },
          { path: '/api/bible/translations/abbreviations', method: 'GET', description: 'Get a simplified list of Bible translation abbreviations' },
          { path: '/api/bible/cache/stats', method: 'GET', description: 'Get Bible API usage statistics' },
          { path: '/api/bible/cache/clear', method: 'POST', description: 'Clear Bible verse cache' }
        ]
      },
      vector: {
        description: 'Vector database API endpoints',
        endpoints: [
          { path: '/api/vector/status', method: 'GET', description: 'Check vector database status' },
          { path: '/api/vector/embed', method: 'POST', description: 'Generate vector embeddings for text' },
          { path: '/api/vector/search', method: 'POST', description: 'Search vector database for similar content' },
          { path: '/api/vector/upsert', method: 'POST', description: 'Add or update documents in the vector database' },
          { path: '/api/vector/delete', method: 'POST', description: 'Delete documents from the vector database' }
        ]
      },
      cache: {
        description: 'Cache API endpoints',
        endpoints: [
          { path: '/api/cache/:key', method: 'GET', description: 'Retrieve a value from the cache' },
          { path: '/api/cache/:key', method: 'POST', description: 'Store a value in the cache' },
          { path: '/api/cache/:key', method: 'DELETE', description: 'Remove a value from the cache' },
          { path: '/api/cache/stats', method: 'GET', description: 'Get cache statistics' }
        ]
      },
      generate: {
        description: 'Text generation API endpoints',
        endpoints: [
          { path: '/api/generate/text', method: 'POST', description: 'Generate text using AI' },
          { path: '/api/generate/embedding', method: 'POST', description: 'Generate embeddings for text' }
        ]
      },
      ask: {
        description: 'Question answering API',
        endpoints: [
          { path: '/api/ask', method: 'POST', description: 'Ask a question or query to get an AI-powered response' }
        ]
      },
      youtube: {
        description: 'YouTube data API',
        endpoints: [
          { path: '/api/youtube/video/:videoId', method: 'GET', description: 'Get metadata and transcription for a YouTube video' },
          { path: '/api/youtube/channel/:channelId', method: 'GET', description: 'Get information about a YouTube channel' },
          { path: '/api/youtube/search', method: 'GET', description: 'Search for YouTube videos' }
        ]
      }
    },
    documentation: {
      swagger: '/api-docs',
      baseUrl: process.env.NODE_ENV === 'production' ? process.env.API_BASE_URL : 'http://localhost:4000'
    }
  });
});

// Mount API routes
app.use('/api', router);

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

    // Add other service initializations here as needed
    // ...
    
    return true;
  } catch (error) {
    logger.error('Failed to initialize services', { error });
    return false;
  }
}

// Start the server after initializing services
const PORT = process.env.PORT || 4000;
initializeServices().then(() => {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
});
