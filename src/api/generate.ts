import { Request, Response, Router } from 'express';
import { performance } from 'perf_hooks';
import expressAsyncHandler from '../utils/asyncHandler';
// Create llmService implementation
interface LLMResult {
  text: string;
  provider?: string;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

async function handleLLMRequest(req: Request, res: Response): Promise<LLMResult> {
  // This is a simplified implementation
  // In a real project, this would be imported from an actual service
  return {
    text: "This is a simulated AI response",
    provider: "simulated",
    tokenUsage: { prompt: 10, completion: 5, total: 15 }
  };
};

const router = Router();

/**
 * POST handler for generating AI responses
 */
router.post('/', expressAsyncHandler(async (req: Request, res: Response) => {
  const requestStartTime = performance.now();
  
  try {
    // Get the prompt from the request body
    const { prompt } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request: prompt is required and must be a string' 
      });
    }

    // Instead of making an HTTP call like in the Next.js version,
    // we directly call the service function
    const result = await handleLLMRequest(req, res);
    
    // If the service function handled the response, we're done
    if (res.headersSent) {
      return;
    }
    
    // Otherwise, we send the response with latency info
    const responseData = {
      ...result,
      latencyMs: Math.round(performance.now() - requestStartTime)
    };
    
    return res.json(responseData);
  } catch (error) {
    // Handle any errors in the handler itself
    console.error('Generate API error:', error);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
}));

export default router;
