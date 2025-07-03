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
 * @swagger
 * /api/generate:
 *   post:
 *     summary: Generate AI responses
 *     tags: [AI Generation]
 *     description: Generate AI text responses using LLM services with prompt input and performance metrics
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: The text prompt for AI generation
 *                 example: "Write a brief explanation of artificial intelligence"
 *                 minLength: 1
 *                 maxLength: 4000
 *     responses:
 *       200:
 *         description: AI response generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 text:
 *                   type: string
 *                   description: Generated AI response text
 *                   example: "Artificial intelligence (AI) refers to the simulation of human intelligence..."
 *                 provider:
 *                   type: string
 *                   description: AI provider used for generation
 *                   example: "openai"
 *                 tokenUsage:
 *                   type: object
 *                   description: Token usage statistics
 *                   properties:
 *                     prompt:
 *                       type: number
 *                       description: Tokens used in prompt
 *                       example: 15
 *                     completion:
 *                       type: number
 *                       description: Tokens used in completion
 *                       example: 85
 *                     total:
 *                       type: number
 *                       description: Total tokens used
 *                       example: 100
 *                 latencyMs:
 *                   type: number
 *                   description: Response latency in milliseconds
 *                   example: 1250
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid request: prompt is required and must be a string"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 *                 details:
 *                   type: string
 *                   description: Error details (only in development mode)
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
