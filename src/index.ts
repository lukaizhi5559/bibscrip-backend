import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import router from './api';
import { logger } from './utils';
import { vectorDbService } from './services/vectorDbService';

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
