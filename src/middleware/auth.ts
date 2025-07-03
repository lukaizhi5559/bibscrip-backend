/**
 * Authentication middleware for JWT and API Key validation
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

// Extend Request interface to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
      };
      apiKey?: string;
    }
  }
}

/**
 * JWT Authentication Middleware
 */
export const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET not configured');
      res.status(500).json({ error: 'Authentication configuration error' });
      return;
    }

    const decoded = jwt.verify(token, jwtSecret, {
      issuer: 'thinkdrop-ai',
      audience: 'thinkdrop-users'
    }) as any;
    req.user = {
      id: decoded.id || decoded.sub,
      email: decoded.email,
      role: decoded.role || 'user'
    };

    next();
  } catch (error) {
    logger.error('JWT verification failed:', { error: error instanceof Error ? error.message : String(error) });
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

/**
 * API Key Authentication Middleware
 */
export const authenticateAPIKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  // Validate API key against environment variable or database
  const validApiKey = process.env.THINKDROP_API_KEY;
  if (!validApiKey) {
    logger.error('THINKDROP_API_KEY not configured');
    res.status(500).json({ error: 'API key configuration error' });
    return;
  }

  if (apiKey !== validApiKey) {
    logger.warn('Invalid API key attempt:', { apiKey: apiKey.substring(0, 8) + '...' });
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  req.apiKey = apiKey;
  // Set a default user for API key authentication
  req.user = {
    id: 'api-user',
    role: 'api'
  };

  next();
};

/**
 * Flexible authentication middleware that accepts either JWT or API Key
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // Try JWT first
  if (authHeader && authHeader.startsWith('Bearer ')) {
    authenticateJWT(req, res, next);
    return;
  }

  // Fall back to API key
  if (apiKey) {
    authenticateAPIKey(req, res, next);
    return;
  }

  // No authentication provided
  res.status(401).json({ 
    error: 'Authentication required',
    message: 'Provide either Bearer token or X-API-Key header'
  });
};

/**
 * Optional authentication middleware - allows unauthenticated requests
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // If no auth provided, continue without user
  if (!authHeader && !apiKey) {
    next();
    return;
  }

  // If auth is provided, validate it
  authenticate(req, res, next);
};

/**
 * Role-based authorization middleware
 */
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRole = req.user.role || 'user';
    if (!roles.includes(userRole)) {
      res.status(403).json({ 
        error: 'Insufficient permissions',
        required: roles,
        current: userRole
      });
      return;
    }

    next();
  };
};
