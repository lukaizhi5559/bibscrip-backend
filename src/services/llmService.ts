import { Request, Response } from 'express';
import { getBestLLMResponse } from '../utils/llmRouter';

export const handleLLMRequest = async (req: Request, res: Response) => {
  try {
    const result = await getBestLLMResponse(req.body.prompt);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: 'LLM processing failed', details: err });
  }
};
