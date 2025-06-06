import { Request, Response, Router } from 'express';
import expressAsyncHandler from '../utils/asyncHandler';

const router = Router();

/**
 * YouTube API proxy for handling video search and data retrieval
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
 * Get detailed information about a specific video
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
