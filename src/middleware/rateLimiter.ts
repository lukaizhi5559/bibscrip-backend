// Rate limiting middleware for API endpoints
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { quotaService } from '../services/quotaService';
import { analytics } from '../utils/analytics';
import { logger } from '../utils/logger';

// Extend Express Request interface to support quota information
declare global {
  namespace Express {
    interface Request {
      quotaExceeded?: boolean;
      quotaInfo?: {
        resetIn: number;
        tier: string;
        upgrade: string;
      };
    }
  }
}

/**
 * Get client IP address from request
 */
const getClientIp = (req: Request): string => {
  // Try to get forwarded IP first (for proxies)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0];
  }
  
  // Fall back to direct connection IP
  return req.socket.remoteAddress || '0.0.0.0';
};

/**
 * Get user ID from request if available
 * In a real app, this would be extracted from an auth token
 */
const getUserId = (req: Request): string | undefined => {
  // For authenticated users, get their ID from the auth token/session
  if (req.headers.authorization) {
    // This is a placeholder - in a real app you'd verify the token
    // and extract the user ID
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      // Extract the token
      const token = authHeader.substring(7);
      // This would normally be JWT verification
      // For now just return a placeholder
      return `user_${token.substring(0, 8)}`;
    }
  }
  
  // For testing, allow user ID from query param
  if (req.query.userId && typeof req.query.userId === 'string') {
    return req.query.userId;
  }
  
  return undefined;
};

/**
 * Rate limiting middleware
 * Limits requests based on user tier and endpoint
 */
export const rateLimiter = (endpoint: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const userId = getUserId(req);
    const path = req.path;
    
    try {
      const rateLimit = await quotaService.checkRateLimit(ip, endpoint, userId);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', rateLimit.allowed ? '1' : '0');
      res.setHeader('X-RateLimit-Remaining', rateLimit.resetMs);
      res.setHeader('X-RateLimit-Reset', Date.now() + rateLimit.resetMs);
      
      // Track rate limit check in analytics
      (analytics as any).trackRateLimit({
        ip,
        userId,
        endpoint,
        allowed: rateLimit.allowed,
        tier: rateLimit.tier,
      });
      
      if (!rateLimit.allowed) {
        logger.warn('Rate limit exceeded', { ip, userId, endpoint });
        
        return res.status(429).json({
          error: 'Too many requests',
          message: 'You have exceeded your rate limit. Please try again later.',
          resetIn: Math.ceil(rateLimit.resetMs / 1000),
        });
      }
      
      next();
    } catch (error) {
      // If rate limiting fails, allow the request (fail open for availability)
      logger.error('Rate limiting error', { error, ip, endpoint });
      next();
    }
  };
};

/**
 * Quota checking middleware
 * Enforces daily limits on API requests
 */
export const quotaChecker = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const userId = getUserId(req);
    
    try {
      // Get complexity from query param or default to moderate
      let complexity = req.query.complexity as string || 'moderate';
      if (!['simple', 'moderate', 'complex'].includes(complexity)) {
        complexity = 'moderate';
      }
      
      const quota = await quotaService.checkQuota(
        ip,
        userId,
        complexity as any // Type casting as the typescript definition matches
      );
      
      // Set quota headers
      res.setHeader('X-Quota-Remaining', quota.remaining.toString());
      res.setHeader('X-Quota-ResetIn', quota.resetIn.toString());
      res.setHeader('X-User-Tier', quota.tier);
      
      // Track quota check in analytics
      (analytics as any).trackQuotaCheck({
        ip,
        userId,
        complexity,
        allowed: quota.allowed,
        remaining: quota.remaining,
        tier: quota.tier,
      });
      
      if (!quota.allowed) {
        logger.warn('Quota exceeded - allowing request to proceed with LLM fallback', { ip, userId, complexity });
        
        // Instead of blocking the request, set a flag to indicate quota exceeded
        // This allows the LLM router to use fallback providers or cached responses
        req.quotaExceeded = true;
        req.quotaInfo = {
          resetIn: quota.resetIn,
          tier: quota.tier,
          upgrade: !userId ? 'Create an account for higher limits' : 'Upgrade your plan for higher limits'
        };
        
        // Set warning headers but don't block the request
        res.setHeader('X-Quota-Exceeded', 'true');
        res.setHeader('X-Quota-Fallback-Mode', 'enabled');
      }
      
      next();
    } catch (error) {
      // If quota checking fails, allow the request (fail open for availability)
      logger.error('Quota checking error', { error: error instanceof Error ? error.message : 'Unknown error', ip });
      
      // Always allow the request to proceed when Redis is unavailable
      next();
    }
  };
};

/**
 * Middleware factory that creates both rate limiting and quota checking
 */
export const createLimiter = (endpoint: string) => {
  return [
    rateLimiter(endpoint),
    quotaChecker(),
  ];
};

/**
 * Graceful degradation middleware
 * When system is under high load, this middleware can be used to selectively
 * shed load or provide alternative responses
 */
export const gracefulDegradation = (options: { priority: 'high' | 'medium' | 'low' }) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Get current system load (this would come from a monitoring service)
    // For now, just simulating with a random value
    const systemLoad = Math.random();
    const highLoadThreshold = 0.9;  // 90% load
    const mediumLoadThreshold = 0.7; // 70% load
    
    // Based on priority and system load, decide what to do
    if (systemLoad > highLoadThreshold) {
      // System is under very high load
      if (options.priority === 'low') {
        // For low priority endpoints, return 503 during high load
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'The system is currently under high load. Please try again later.',
        });
      }
    } else if (systemLoad > mediumLoadThreshold) {
      // System is under moderate load
      if (options.priority === 'low') {
        // Set a shorter timeout for low priority requests
        req.setTimeout(2000); // 2 second timeout
      }
    }
    
    // Continue for high priority or normal load
    next();
  };
};

/**
 * Enhanced logging middleware for requests
 */
export const requestLogger = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const userId = getUserId(req);
    const startTime = Date.now();
    
    // Log request start
    logger.debug('API request started', {
      method: req.method,
      path: req.path,
      ip,
      userId,
    });
    
    // Capture response to log metrics
    const originalSend = res.send;
    res.send = function(body): Response {
      const responseTime = Date.now() - startTime;
      
      // Log request completion
      logger.debug('API request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime,
      });
      
      // Track in analytics
      (analytics as any).trackAIRequest({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime,
        ip,
        userId,
      });
      
      return originalSend.call(this, body);
    };
    
    next();
  };
};
