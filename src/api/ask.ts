import { Request, Response, Router } from 'express';
import { performance } from 'perf_hooks';
import expressAsyncHandler from '../utils/asyncHandler';

// Import core utilities
import { getAIResponse } from '../utils/ai';
import { getBibleVerse, BibleVerse } from '../utils/bible';
import { extractVerseReferences } from '../utils/verse-parser';
import { makeRequest, AIErrorResponse } from '../utils/request-manager';
import { cacheManager, createCacheKey } from '../utils/cache-manager';
import { analytics } from '../utils/analytics';
import { logger } from '../utils/logger';
import { semanticCache } from '../services/semanticCacheService';

// Import RAG and scaling services
import { ragService } from '../services/ragService';
import { queueService } from '../services/queueService';

// Import middleware for rate limiting
import { rateLimiter, quotaChecker, requestLogger } from '../middleware/rateLimiter';

// Define AI response interfaces for better type safety
interface AIResponseObject {
  text: string;
  provider?: string;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

interface AIResultObject {
  data: AIResponseObject | AIErrorResponse | string;
  provider: string;
  fromCache: boolean;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  latencyMs: number;
  cacheAge: number;
}

// Common Bible translation abbreviations
const TRANSLATIONS = ['ESV', 'KJV', 'NKJV', 'NLT', 'NASB', 'NRSV', 'MSG', 'AMP', 'CSB', 'WEB', 'NIV'];

/**
 * Extracts the preferred Bible translation from a question if specified
 * Examples: "Show John 3:16 in ESV" or "What does Genesis 1:1 mean (KJV)"
 * @param question User question text
 * @returns The translation code if found, undefined otherwise
 */
function extractTranslationPreference(question: string): string | undefined {
  // Check for explicit mentions of translations
  const translationRegex = new RegExp(`\\b(${TRANSLATIONS.join('|')})\\b`, 'i');
  const match = question.match(translationRegex);
  
  if (match) {
    return match[1].toUpperCase();
  }
  
  // Check for phrases like "in the ESV translation" or "using ESV"
  const phraseRegex = /\b(?:in|using|from|with)\s+(?:the\s+)?([A-Z]+)(?:\s+(?:translation|version|bible))?\b/i;
  const phraseMatch = question.match(phraseRegex);
  
  if (phraseMatch && TRANSLATIONS.includes(phraseMatch[1].toUpperCase())) {
    return phraseMatch[1].toUpperCase();
  }
  
  return undefined;
}

// Keep a map of active requests to prevent duplicate submissions
const activeRequests = new Map<string, Set<string>>();

/**
 * Check if a request is a duplicate that's currently being processed
 * @param ip The IP address
 * @param requestId The request ID or cache key
 * @returns Whether this is a duplicate in-flight request
 */
function isDuplicateRequest(ip: string, requestId: string): boolean {
  const ipActiveRequests = activeRequests.get(ip) || new Set<string>();
  
  if (ipActiveRequests.has(requestId)) {
    return true;
  }
  
  // Register this request
  ipActiveRequests.add(requestId);
  activeRequests.set(ip, ipActiveRequests);
  
  return false;
}

/**
 * Mark a request as completed to allow future duplicate requests
 */
function completeRequest(ip: string, requestId: string): void {
  const ipActiveRequests = activeRequests.get(ip);
  if (ipActiveRequests) {
    ipActiveRequests.delete(requestId);
    if (ipActiveRequests.size === 0) {
      activeRequests.delete(ip);
    }
  }
}

const router = Router();

// Initialize RAG service on startup
ragService.initialize().catch(error => {
  logger.error('Failed to initialize RAG service', { error });
});

/**
 * Enhanced POST handler with RAG, request pooling, rate limiting, and analytics
 */
router.post('/', [
  // Apply middleware for logging, rate limiting and quota checks
  requestLogger(),
  rateLimiter('ask'),
  quotaChecker()
], expressAsyncHandler(async (req: Request, res: Response) => {
  const requestStartTime = performance.now();
  
  // Get client IP from X-Forwarded-For or remote address
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = ((Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || 
             req.socket.remoteAddress || '0.0.0.0').toString();
             
  // Get user ID from authentication if available
  const userId = req.headers.authorization ? 
    // In a real app, extract from JWT token
    `user_${req.headers.authorization.substring(7, 15)}` : undefined;
  
  let cacheKey = '';
  
  try {
    // Get the question from the request body
    const { question, forceRefresh = false } = req.body;
    
    // Validate input
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request: question is required and must be a string' 
      });
    }
    
    // Check for rate limiting
    
    // Extract preferred translation from the question (if specified)
    const preferredTranslation = extractTranslationPreference(question);
    
    // Create a normalized cache key for the question
    cacheKey = createCacheKey({
      question: question.trim(),
      translation: preferredTranslation || 'default'
    });
    
    // Check if this is a duplicate in-flight request
    if (isDuplicateRequest(ip, cacheKey)) {
      return res.status(429).json({
        error: 'A duplicate request is already being processed. Please wait for it to complete.',
        isDuplicate: true
      });
    }
    
    // Classify the query complexity
    const complexity = await ragService.classifyQuery(question);
    
    try {
      // Process through RAG system to retrieve relevant context
      const ragResult = await ragService.process(question);
      
      // For non-cached requests, use the queuing system for request pooling and batching
      let aiResult;
      
      if (forceRefresh) {
        // Skip cache and directly process with RAG
        const augmentedPrompt = ragService.createAugmentedPrompt(question, ragResult.contexts);
        
        // Queue the request for processing
        const requestId = await queueService.queueAIRequest(augmentedPrompt, userId, ip);
        
        // Get AI response using the augmented prompt with context
        const response = await getAIResponse(augmentedPrompt);
        
        // Store successful responses for future retrieval
        if (typeof response === 'object' && 'text' in response) {
          const aiResponse = response as AIResponseObject;
          await ragService.storeSuccessfulResponse(question, aiResponse.text);
          
          // Store in semantic cache for future similar questions
          await semanticCache.store(question, aiResponse);
          
          aiResult = {
            data: aiResponse,
            provider: aiResponse.provider || 'unknown',
            fromCache: false,
            tokenUsage: aiResponse.tokenUsage || { total: 0 },
            latencyMs: ragResult.latencyMs + (performance.now() - requestStartTime),
            cacheAge: 0
          };
        } else {
          // Handle string response format
          const responseText = typeof response === 'string' ? response : JSON.stringify(response);
          await ragService.storeSuccessfulResponse(question, responseText);
          
          // Store in semantic cache as well
          await semanticCache.store(question, { text: responseText, provider: 'unknown' });
          
          aiResult = {
            data: responseText,
            provider: 'unknown',
            fromCache: false,
            tokenUsage: { total: 0 },
            latencyMs: ragResult.latencyMs + (performance.now() - requestStartTime),
            cacheAge: 0
          };
        }
      } else {
        // First check semantic cache for similar questions
        const semanticCacheResult = await semanticCache.find(question);
        
        if (semanticCacheResult) {
          // Found a semantic match!
          const { cachedResponse, similarity, exactMatch } = semanticCacheResult;
          
          // Log the semantic cache hit
          analytics.trackCacheOperation({
            operation: 'hit', // Use standard hit operation
            key: cacheKey
          });
          
          // Log additional metrics for semantic matching
          logger.info(`Semantic cache ${exactMatch ? 'exact' : 'similar'} match: ${similarity.toFixed(3)} for "${question.substring(0, 50)}..."`, {
            service: 'bibscrip-backend',
            component: 'semanticCache',
            operation: exactMatch ? 'hit_exact' : 'hit_semantic',
            similarity: similarity
          });
          
          // Return the cached response with metadata
          aiResult = {
            data: cachedResponse.answer,
            provider: cachedResponse.answer.provider || 'unknown',
            fromCache: true,
            semanticMatch: !exactMatch,
            similarity: similarity,
            originalQuestion: exactMatch ? null : cachedResponse.question,
            tokenUsage: (typeof cachedResponse.answer === 'object' && cachedResponse.answer.tokenUsage) 
              ? cachedResponse.answer.tokenUsage 
              : { total: 0 },
            latencyMs: performance.now() - requestStartTime,
            cacheAge: Date.now() - cachedResponse.timestamp
          };
        } else {
          // Fallback to standard request if no semantic match
          aiResult = await makeRequest(
            async () => {
              try {
                // Create augmented prompt with context
                const augmentedPrompt = ragService.createAugmentedPrompt(question, ragResult.contexts);
                
                // Get response from AI model with context
                const response = await getAIResponse(augmentedPrompt);
                
                // Store successful response for future retrieval
                if (typeof response === 'object' && 'text' in response) {
                  const aiResponse = response as AIResponseObject;
                  await ragService.storeSuccessfulResponse(question, aiResponse.text);
                  
                  // Also store in semantic cache
                  await semanticCache.store(question, aiResponse);
                  
                  return aiResponse;
                } else {
                  // Handle string response format
                  const responseText = typeof response === 'string' ? response : JSON.stringify(response);
                  await ragService.storeSuccessfulResponse(question, responseText);
                  
                  // Also store in semantic cache
                  await semanticCache.store(question, { text: responseText, provider: 'unknown' });
                  
                  return responseText;
                }
              } catch (error) {
                // Return error response
                return {
                  error: 'Failed to get AI response',
                  details: error instanceof Error ? error.message : String(error)
                };
              }
            },
            {
              cacheKey,
              forceRefresh: false,
              onCacheMiss: () => {
                analytics.trackCacheOperation({
                  operation: 'miss',
                  key: cacheKey
                });
              }
            }
          );
        }
      }
      
      // Extract verse references from both question and response
      const questionVerses = extractVerseReferences(question);
      
      // Add detailed debugging for the AI result data structure
      console.log('AI RESULT DATA STRUCTURE:', JSON.stringify(aiResult, null, 2));
      
      // Check if the AI response is a string or an error object
      let aiResponseText: string = '';
      
      // Handle the various ways the AI response can be structured
      if (typeof aiResult.data === 'string') {
        // Handle when data is directly a string
        console.log('AI result is a string');
        aiResponseText = aiResult.data;
      } else if (typeof aiResult.data === 'object' && aiResult.data) {
        console.log('AI result is an object');
        
        if ('error' in aiResult.data) {
          // Handle error response format
          console.log('AI result contains error property');
          const errorResponse = aiResult.data as AIErrorResponse;
          aiResponseText = errorResponse.error;
        } else if ('text' in aiResult.data) {
          // Handle standard AI response object format
          console.log('AI result contains text property');
          const aiResponse = aiResult.data as AIResponseObject;
          aiResponseText = aiResponse.text;
        } else if (aiResult.fromCache) {
          // Special handling for semantic cache results
          console.log('AI result is from cache');
          
          // Log the exact structure to identify the correct path to extract text
          console.log('CACHED RESPONSE STRUCTURE:', JSON.stringify(aiResult.data, null, 2));
          
          // Try to extract text from common patterns in cached responses
          if (aiResult.data.answer && typeof aiResult.data.answer === 'string') {
            // Handle when answer is directly a string
            console.log('Found string answer in cache');
            aiResponseText = aiResult.data.answer;
          } else if (aiResult.data.answer && typeof aiResult.data.answer === 'object') {
            console.log('Found object answer in cache');
            if (aiResult.data.answer.text) {
              console.log('Found text property in answer object');
              aiResponseText = aiResult.data.answer.text;
            } else if (typeof aiResult.data.answer === 'string') {
              console.log('Answer is directly a string');
              aiResponseText = aiResult.data.answer;
            }
            // If we still don't have text, try more patterns
            if (!aiResponseText && aiResult.data.text) {
              console.log('Found text property directly in data');
              aiResponseText = aiResult.data.text;
            }
          } else {
            // Fallback: Try other common patterns
            console.log('Trying fallback extraction patterns');
            if (aiResult.data.text) {
              aiResponseText = aiResult.data.text;
            } else if (aiResult.data.content) {
              aiResponseText = aiResult.data.content;
            } else if (aiResult.data.response) {
              aiResponseText = aiResult.data.response;
            }
          }
          
          // If we still have no text, set a fallback message
          if (!aiResponseText) {
            console.error('Failed to extract AI text from cache:', JSON.stringify(aiResult.data));
            aiResponseText = 'Error extracting response from cache';
          }
        } else {
          // Unknown object format - log it for debugging
          console.error('Unrecognized AI result format:', JSON.stringify(aiResult.data));
          aiResponseText = 'Error processing your request';
        }
      } else {
        // Complete fallback if all else fails
        console.error('AI result data is null or undefined');
        aiResponseText = 'Error processing your request';
      }
      
      console.log('FINAL AI RESPONSE TEXT:', aiResponseText);
      
      const aiResponseVerses = extractVerseReferences(aiResponseText);
      const verseRefsToFetch = Array.from(new Set([...questionVerses, ...aiResponseVerses]));
      
      // Fetch Bible verses with caching
      const fetchedVerses: BibleVerse[] = [];
      if (verseRefsToFetch.length > 0) {
        // Create individual promises for each verse
        const versePromises = verseRefsToFetch.map(async (ref) => {
          // Create a verse-specific cache key
          const verseCacheKey = `verse:${ref}:${preferredTranslation || 'default'}`;
          
          // Check cache first
          const cachedVerse = await cacheManager.get<BibleVerse>(verseCacheKey);
          if (cachedVerse && !forceRefresh) {
            analytics.trackCacheOperation({
              operation: 'hit',
              key: verseCacheKey
            });
            return cachedVerse.data;
          }
          
          // Cache miss, fetch from API
          analytics.trackCacheOperation({
            operation: 'miss',
            key: verseCacheKey
          });
          
          const verse = await getBibleVerse(ref, preferredTranslation);
          
          // Cache the result if found
          if (verse) {
            await cacheManager.set(verseCacheKey, verse, {
              ttl: 365 * 24 * 60 * 60 * 1000 // Bible verses can be cached for a year
            });
          }
          
          return verse;
        });
        
        // Execute all verse fetches in parallel
        const results = await Promise.allSettled(versePromises);
        
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            fetchedVerses.push(result.value);
          }
        });
      }
      
      // Track AI request in analytics with enhanced data
      analytics.trackAIRequest({
        provider: aiResult.provider || 'unknown',
        fromCache: aiResult.fromCache,
        tokenUsage: aiResult.tokenUsage,
        latencyMs: aiResult.latencyMs,
        status: 'success',
        query: question,
        cacheKey,
        cacheAge: aiResult.cacheAge,
        complexity: complexity
      });
      
      // Complete the request to allow duplicates again
      completeRequest(ip, cacheKey);
      
      // Check if we have a valid AI response text
      if (!aiResponseText || aiResponseText.trim() === '') {
        console.error('Empty AI response text detected before sending response - attempting fallback');
        
        // Fallback: If we have a data structure but couldn't extract text, use a default message
        if (aiResult && aiResult.data) {
          console.log('Using fallback response mechanism');
          // Try one more approach to get something from the data
          if (typeof aiResult.data === 'object' && aiResult.data !== null) {
            // Convert the entire data object to a string
            const dataString = JSON.stringify(aiResult.data);
            aiResponseText = `Cached response available but could not be formatted properly. Raw data: ${dataString.substring(0, 500)}`;
          } else {
            aiResponseText = 'Response available but could not be properly formatted';
          }
        } else {
          aiResponseText = 'No AI response available';
        }
      }
      
      // Log the final response structure
      console.log('SENDING RESPONSE TO FRONTEND:', {
        hasAiText: !!aiResponseText,
        textLength: aiResponseText?.length || 0,
        versesCount: fetchedVerses.length,
        provider: aiResult.provider,
        fromCache: aiResult.fromCache
      });
      
      // DIRECT FIX: Extract just the essential text for the AI response
      // This bypasses any potential serialization issues
      let finalAiText = '';
      
      if (aiResponseText && aiResponseText.trim().length > 0) {
        // Clean the text to avoid any issues
        finalAiText = aiResponseText
          .trim()
          .replace(/\u0000/g, ''); // Remove null bytes that might cause JSON issues
      } else {
        finalAiText = 'No AI response available';
      }
      
      // Log the final text for debugging
      console.log(`FINAL AI TEXT (${finalAiText.length} chars): ${finalAiText.substring(0, 50)}...`);
      
      // Create a simplified response object
      const responseObj = {
        ai: finalAiText,
        verses: fetchedVerses || [],
        sources: (ragResult && ragResult.contexts) ? ragResult.contexts.map(ctx => ({
          source: ctx.source,
          reference: ctx.reference, 
          score: Math.round(ctx.score * 100) / 100
        })) : [],
        latencyMs: Math.round(performance.now() - requestStartTime)
      };
      
      // Set response headers to avoid any issues
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      
      // Extra precaution - ensure no compression middleware interferes
      res.setHeader('Content-Encoding', 'identity');
      
      // Convert to string first to ensure we see exactly what's being sent
      const jsonString = JSON.stringify(responseObj);
      console.log(`SENDING JSON STRING (${jsonString.length} chars)`);
      
      // Send without using express json middleware
      return res.send(jsonString);
    } finally {
      // Ensure we clean up the request tracking even if there's an error
      completeRequest(ip, cacheKey);
    }
  } catch (error) {
    // Log the error
    console.error('Error in /api/ask handler:', error);
    
    // Track the error in analytics with more detail
    analytics.trackAIRequest({
      provider: 'unknown',
      fromCache: false,
      latencyMs: performance.now() - requestStartTime,
      status: 'error',
      errorType: error instanceof Error ? error.name : 'Unknown',
      query: req.body?.question || ''
    });
    
    // Log the error
    logger.error('Error processing question', {
      error: error instanceof Error ? error.message : String(error),
      ip,
      userId: userId || 'anonymous'
    });
    
    // Clean up request tracking
    completeRequest(ip, cacheKey);
    
    // Return an error response
    return res.status(500).json({ 
      error: 'An error occurred while processing your request. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
    });
  }
}));

export default router;
