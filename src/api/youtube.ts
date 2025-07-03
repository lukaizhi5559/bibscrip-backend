import { Request, Response, Router } from 'express';
import expressAsyncHandler from '../utils/asyncHandler';

const router = Router();

/**
 * @swagger
 * /api/youtube:
 *   get:
 *     summary: Search YouTube videos
 *     tags: [YouTube]
 *     description: Proxy endpoint for YouTube API to search for videos with specified query parameters
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query for YouTube videos
 *         example: "Bible study"
 *       - in: query
 *         name: maxResults
 *         schema:
 *           type: string
 *           default: "5"
 *         description: Maximum number of results to return
 *         example: "10"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           default: "video"
 *           enum: [video, channel, playlist]
 *         description: Type of resource to search for
 *       - in: query
 *         name: apiKey
 *         schema:
 *           type: string
 *         description: YouTube API key (optional, uses environment variable as fallback)
 *     responses:
 *       200:
 *         description: YouTube search results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kind:
 *                   type: string
 *                   example: "youtube#searchListResponse"
 *                 etag:
 *                   type: string
 *                 nextPageToken:
 *                   type: string
 *                 regionCode:
 *                   type: string
 *                 pageInfo:
 *                   type: object
 *                   properties:
 *                     totalResults:
 *                       type: number
 *                     resultsPerPage:
 *                       type: number
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       kind:
 *                         type: string
 *                       etag:
 *                         type: string
 *                       id:
 *                         type: object
 *                         properties:
 *                           kind:
 *                             type: string
 *                           videoId:
 *                             type: string
 *                       snippet:
 *                         type: object
 *                         properties:
 *                           publishedAt:
 *                             type: string
 *                             format: date-time
 *                           channelId:
 *                             type: string
 *                           title:
 *                             type: string
 *                           description:
 *                             type: string
 *                           thumbnails:
 *                             type: object
 *                           channelTitle:
 *                             type: string
 *       400:
 *         description: Invalid request - search query required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Search query is required"
 *       500:
 *         description: YouTube API error or configuration issue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "YouTube API key is not configured"
 *                 details:
 *                   type: string
 *                   description: Error details (only in development mode)
 */
router.get('/', expressAsyncHandler(async (req: Request, res: Response) => {
  try {
    // Get query parameters
    const { q, maxResults = '5', type = 'video', apiKey } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use environment variable as fallback if API key not provided in query
    const youtubeApiKey = apiKey || process.env.YOUTUBE_API_KEY;
    
    if (!youtubeApiKey) {
      return res.status(500).json({ error: 'YouTube API key is not configured' });
    }
    
    // Build YouTube API URL
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    apiUrl.searchParams.append('part', 'snippet');
    apiUrl.searchParams.append('q', q as string);
    apiUrl.searchParams.append('maxResults', maxResults as string);
    apiUrl.searchParams.append('type', type as string);
    apiUrl.searchParams.append('key', youtubeApiKey as string);
    
    // Make request to YouTube API
    const response = await fetch(apiUrl.toString());
    const data = await response.json();
    
    if (!response.ok) {
      console.error('YouTube API error:', data);
      return res.status(response.status).json({
        error: 'YouTube API error',
        details: process.env.NODE_ENV === 'development' ? data : undefined
      });
    }
    
    // Return YouTube search results
    return res.json(data);
  } catch (error) {
    console.error('YouTube API proxy error:', error);
    return res.status(500).json({
      error: 'Error processing YouTube request',
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
}));

/**
 * @swagger
 * /api/youtube/video/{id}:
 *   get:
 *     summary: Get YouTube video details
 *     tags: [YouTube]
 *     description: Retrieve detailed information about a specific YouTube video including snippet, content details, and statistics
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: YouTube video ID
 *         example: "dQw4w9WgXcQ"
 *       - in: query
 *         name: apiKey
 *         schema:
 *           type: string
 *         description: YouTube API key (optional, uses environment variable as fallback)
 *     responses:
 *       200:
 *         description: YouTube video details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kind:
 *                   type: string
 *                   example: "youtube#videoListResponse"
 *                 etag:
 *                   type: string
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       kind:
 *                         type: string
 *                       etag:
 *                         type: string
 *                       id:
 *                         type: string
 *                       snippet:
 *                         type: object
 *                         properties:
 *                           publishedAt:
 *                             type: string
 *                             format: date-time
 *                           channelId:
 *                             type: string
 *                           title:
 *                             type: string
 *                           description:
 *                             type: string
 *                           thumbnails:
 *                             type: object
 *                           channelTitle:
 *                             type: string
 *                           tags:
 *                             type: array
 *                             items:
 *                               type: string
 *                           categoryId:
 *                             type: string
 *                           defaultLanguage:
 *                             type: string
 *                       contentDetails:
 *                         type: object
 *                         properties:
 *                           duration:
 *                             type: string
 *                             example: "PT4M20S"
 *                           dimension:
 *                             type: string
 *                           definition:
 *                             type: string
 *                           caption:
 *                             type: string
 *                       statistics:
 *                         type: object
 *                         properties:
 *                           viewCount:
 *                             type: string
 *                           likeCount:
 *                             type: string
 *                           favoriteCount:
 *                             type: string
 *                           commentCount:
 *                             type: string
 *                 pageInfo:
 *                   type: object
 *                   properties:
 *                     totalResults:
 *                       type: number
 *                     resultsPerPage:
 *                       type: number
 *       400:
 *         description: Invalid request - video ID required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Video ID is required"
 *       500:
 *         description: YouTube API error or configuration issue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "YouTube API key is not configured"
 *                 details:
 *                   type: string
 *                   description: Error details (only in development mode)
 */
router.get('/video/:id', expressAsyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Video ID is required' });
    }
    
    // Use environment variable as fallback if API key not provided in query
    const youtubeApiKey = apiKey || process.env.YOUTUBE_API_KEY;
    
    if (!youtubeApiKey) {
      return res.status(500).json({ error: 'YouTube API key is not configured' });
    }
    
    // Build YouTube API URL for video details
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    apiUrl.searchParams.append('part', 'snippet,contentDetails,statistics');
    apiUrl.searchParams.append('id', id);
    apiUrl.searchParams.append('key', youtubeApiKey as string);
    
    // Make request to YouTube API
    const response = await fetch(apiUrl.toString());
    const data = await response.json();
    
    if (!response.ok) {
      console.error('YouTube API error:', data);
      return res.status(response.status).json({
        error: 'YouTube API error',
        details: process.env.NODE_ENV === 'development' ? data : undefined
      });
    }
    
    // Return YouTube video details
    return res.json(data);
  } catch (error) {
    console.error('YouTube API video details error:', error);
    return res.status(500).json({
      error: 'Error retrieving YouTube video details',
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
}));

export default router;
