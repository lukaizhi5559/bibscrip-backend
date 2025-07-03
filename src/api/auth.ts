/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: JWT and API key authentication endpoints
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import expressAsyncHandler from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @swagger
 * /api/auth/token:
 *   post:
 *     summary: Generate JWT token for user authentication
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User identifier
 *               email:
 *                 type: string
 *                 description: User email (optional)
 *               role:
 *                 type: string
 *                 description: "User role (default: user)"
 *                 enum: [user, admin, api]
 *     responses:
 *       200:
 *         description: JWT token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT access token
 *                 refreshToken:
 *                   type: string
 *                   description: JWT refresh token
 *                 expiresIn:
 *                   type: string
 *                   description: Token expiration time
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Server error
 */
router.post('/token', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { userId, email, role = 'user' } = req.body;

  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!jwtSecret || !jwtRefreshSecret) {
      logger.error('JWT secrets not configured');
      res.status(500).json({ error: 'Authentication configuration error' });
      return;
    }

    const tokenPayload = {
      id: userId,
      email,
      role,
      iat: Math.floor(Date.now() / 1000)
    };

    // Generate access token (1 hour)
    const accessToken = jwt.sign(tokenPayload, jwtSecret, { 
      expiresIn: '1h',
      issuer: 'thinkdrop-ai',
      audience: 'thinkdrop-users'
    });

    // Generate refresh token (7 days)
    const refreshToken = jwt.sign(
      { id: userId, type: 'refresh' }, 
      jwtRefreshSecret, 
      { 
        expiresIn: '7d',
        issuer: 'thinkdrop-ai',
        audience: 'thinkdrop-users'
      }
    );

    res.json({
      token: accessToken,
      refreshToken,
      expiresIn: '3600', // 1 hour in seconds
      user: {
        id: userId,
        email,
        role
      }
    });

    logger.info('JWT token generated', { userId, role });
  } catch (error) {
    logger.error('Error generating JWT token:', { 
      error: error instanceof Error ? error.message : String(error),
      userId 
    });
    res.status(500).json({ error: 'Failed to generate token' });
  }
}));

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh JWT token using refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Valid refresh token
 *     responses:
 *       200:
 *         description: New JWT token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: New JWT access token
 *                 expiresIn:
 *                   type: string
 *                   description: Token expiration time
 *       400:
 *         description: Missing or invalid refresh token
 *       403:
 *         description: Refresh token expired or invalid
 *       500:
 *         description: Server error
 */
router.post('/refresh', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token is required' });
    return;
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!jwtSecret || !jwtRefreshSecret) {
      logger.error('JWT secrets not configured');
      res.status(500).json({ error: 'Authentication configuration error' });
      return;
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, jwtRefreshSecret) as any;

    if (decoded.type !== 'refresh') {
      res.status(403).json({ error: 'Invalid refresh token type' });
      return;
    }

    // Generate new access token
    const tokenPayload = {
      id: decoded.id,
      iat: Math.floor(Date.now() / 1000)
    };

    const newAccessToken = jwt.sign(tokenPayload, jwtSecret, { 
      expiresIn: '1h',
      issuer: 'thinkdrop-ai',
      audience: 'thinkdrop-users'
    });

    res.json({
      token: newAccessToken,
      expiresIn: '3600' // 1 hour in seconds
    });

    logger.info('JWT token refreshed', { userId: decoded.id });
  } catch (error) {
    logger.error('Error refreshing JWT token:', { 
      error: error instanceof Error ? error.message : String(error)
    });
    
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(403).json({ error: 'Invalid or expired refresh token' });
    } else {
      res.status(500).json({ error: 'Failed to refresh token' });
    }
  }
}));

/**
 * @swagger
 * /api/auth/validate:
 *   get:
 *     summary: Validate current authentication token
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                 authMethod:
 *                   type: string
 *                   enum: [jwt, apiKey]
 *       401:
 *         description: No authentication provided
 *       403:
 *         description: Invalid or expired token
 */
router.get('/validate', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // This endpoint uses the authenticate middleware which will be applied at the router level
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  let authMethod = 'unknown';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    authMethod = 'jwt';
  } else if (apiKey) {
    authMethod = 'apiKey';
  }

  res.json({
    valid: true,
    user: req.user,
    authMethod,
    timestamp: new Date().toISOString()
  });
}));

export default router;
