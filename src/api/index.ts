import express from 'express';
import { handleLLMRequest } from '../services/llmService';

const router = express.Router();

router.post('/generate', handleLLMRequest);

export default router;
