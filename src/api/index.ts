import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import bibleRouter from './bible';
import vectorRouter from './vector';
import cacheRouter from './cache';
import generateRouter from './generate';
import askRouter from './ask';
import llmRouter from './llm';
import youtubeRouter from './youtube';
import authRouter from './auth';
import bibliographyRouter from './bibliography';
import agentsRouter from './agents';
import actionPlannerRouter from './actionPlanner';
import usersRouter from './users';
// Removed: visualAgentRouter, integrationRouter (moved to Electron client)
import streamingRouter from './streaming';
import analyticsRouter from './analytics';
import automationAnalyticsRouter from './automationAnalytics';
// Removed: uiIndexedAgentRouter, enhancedVisualAgentRouter (moved to Electron client)
// Phase 1: Thinkdrop AI Drops Orchestration System
import { createOrchestrationWorkflowRoutes } from './orchestrationWorkflows';
// Phase 2: DropRegistry - Agent Capability Catalog
import dropRegistryRouter from './dropRegistry';
import nutjsRouter from './nutjs';
import pool from '../config/postgres';
// Import other route modules directly instead of using dynamic imports

const router = Router();

// Get the absolute path to the current directory
const apiDir = __dirname;

/**
 * @swagger
 * /api:
 *   get:
 *     summary: Get API overview and available endpoints
 *     tags: [API Overview]
 *     description: Returns a comprehensive list of all available API endpoints with descriptions
 *     responses:
 *       200:
 *         description: API overview retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: "Bibscrip Backend API"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 description:
 *                   type: string
 *                   example: "Backend API for Bible verse retrieval and processing"
 *                 endpoints:
 *                   type: object
 *                   description: Available API endpoint groups
 *                 documentation:
 *                   type: object
 *                   properties:
 *                     swagger:
 *                       type: string
 *                       example: "/api-docs"
 */
router.get('/', (req, res) => {
  res.json({
    name: 'Bibscrip Backend API',
    version: '1.0.0',
    description: 'Backend API for Bible verse retrieval and processing',
    endpoints: {
      bible: {
        path: '/api/bible',
        description: 'Bible verse and translation API',
        endpoints: [
          'GET /api/bible/verse - Get a single Bible verse',
          'GET /api/bible/passage - Get a Bible passage (multiple verses)',
          'GET /api/bible/chapter/{book}/{chapter} - Get entire chapter',
          'GET /api/bible/translations - Get available translations',
          'GET /api/bible/translations/abbreviations - Get translation abbreviations'
        ]
      },
      auth: {
        path: '/api/auth',
        description: 'JWT and API key authentication endpoints',
        endpoints: [
          'POST /api/auth/token - Generate JWT token',
          'POST /api/auth/refresh - Refresh JWT token',
          'POST /api/auth/validate - Validate API key'
        ]
      },
      bibliography: {
        path: '/api/bibliography',
        description: 'Bibliography management and citation API',
        endpoints: [
          'GET /api/bibliography - List all bibliography entries',
          'POST /api/bibliography - Create new bibliography entry',
          'GET /api/bibliography/{id} - Get bibliography entry by ID',
          'PUT /api/bibliography/{id} - Update bibliography entry',
          'DELETE /api/bibliography/{id} - Delete bibliography entry',
          'GET /api/bibliography/search - Search bibliography entries',
          'GET /api/bibliography/{id}/citation - Generate citation'
        ]
      },
      agents: {
        path: '/api/agents',
        description: 'Agent orchestration and management for ThinkDrop AI',
        endpoints: [
          'POST /api/agents/orchestrate - Orchestrate user request and manage agents',
          'POST /api/agents/generate - Generate new agent code',
          'POST /api/agents/generate/batch - Generate multiple agents in parallel',
          'POST /api/agents/generate-with-reuse - Generate agent with reuse optimization',
          'GET /api/agents - List all agents',
          'GET /api/agents/{id} - Get agent by ID',
          'PUT /api/agents/{id} - Update agent',
          'DELETE /api/agents/{id} - Delete agent',
          'POST /api/agents/{id}/execute - Execute specific agent',
          'GET /api/agents/search - Search agents by criteria',
          'POST /api/agents/intent/parse - Parse user intent for agent orchestration',
          'GET /api/agents/health - Get agents service health status'
        ]
      },
      analytics: {
        path: '/api/analytics',
        description: 'Analytics tracking and reporting',
        endpoints: [
          'POST /api/analytics - Record analytics event',
          'GET /api/analytics - Get analytics summary'
        ]
      },
      ask: {
        path: '/api/ask',
        description: 'AI-powered Bible verse queries',
        endpoints: [
          'POST /api/ask - Ask AI-powered Bible questions'
        ]
      },
      llm: {
        path: '/api/llm',
        description: 'Unified LLM Core - Automation-focused AI queries with intent detection',
        endpoints: [
          'POST /api/llm/ask - AI-powered queries with automation intent detection',
          'GET /api/llm/health - Check health of unified LLM core services',
          'GET /api/llm/stats - Get LLM usage statistics and performance metrics'
        ]
      },
      cache: {
        path: '/api/cache',
        description: 'Cache management operations',
        endpoints: [
          'GET /api/cache/{key} - Get cached item',
          'POST /api/cache/{key} - Store cache item',
          'DELETE /api/cache/{key} - Delete cache item'
        ]
      },
      generate: {
        path: '/api/generate',
        description: 'AI text generation',
        endpoints: [
          'POST /api/generate - Generate AI text content'
        ]
      },
      integration: {
        path: '/api/integration',
        description: 'ThinkDrop AI integration services',
        endpoints: [
          'POST /api/integration/services/start - Start integration services',
          'POST /api/integration/services/stop - Stop integration services',
          'GET /api/integration/services/status - Get service status',
          'GET /api/integration/ipc/clients - Get IPC clients',
          'POST /api/integration/ipc/send - Send IPC message',
          'POST /api/integration/ipc/broadcast - Broadcast IPC message',
          'POST /api/integration/visual-agent/workflow - Execute visual agent workflow'
        ]
      },
      vector: {
        path: '/api/vector',
        description: 'Vector database operations',
        endpoints: [
          'POST /api/vector/store - Store document in vector DB',
          'POST /api/vector/batch - Batch store documents',
          'POST /api/vector/search - Semantic search',
          'DELETE /api/vector/{id} - Delete document',
          'DELETE /api/vector/batch - Delete multiple documents',
          'DELETE /api/vector/namespace/{namespace} - Clear namespace',
          'GET /api/vector/status - Get vector DB status'
        ]
      },
      'visual-agent': {
        path: '/api/visual-agent',
        description: 'Desktop automation and visual agent workflow',
        endpoints: [
          'GET /api/visual-agent/status - Get visual agent status',
          'POST /api/visual-agent/screenshot - Take screenshot',
          'POST /api/visual-agent/analyze - Analyze screenshot',
          'POST /api/visual-agent/plan - Generate action plan',
          'POST /api/visual-agent/execute - Execute actions',
          'POST /api/visual-agent/execute-prompt - Execute with prompt',
          'POST /api/visual-agent/emergency-stop - Emergency stop',
          'GET /api/visual-agent/mouse-position - Get mouse position',
          'GET /api/visual-agent/screen-dimensions - Get screen dimensions'
        ]
      },

      youtube: {
        path: '/api/youtube',
        description: 'YouTube API proxy',
        endpoints: [
          'GET /api/youtube - Search YouTube videos',
          'GET /api/youtube/video/{id} - Get video details'
        ]
      },
      'ui-indexed-agent': {
        path: '/api/ui-indexed-agent',
        description: 'UI-Indexed Intelligent Agent for desktop automation',
        endpoints: [
          'GET /api/ui-indexed-agent/health - Get agent health status',
          'POST /api/ui-indexed-agent/daemon/start - Start UI indexer daemon',
          'POST /api/ui-indexed-agent/daemon/stop - Stop UI indexer daemon',
          'GET /api/ui-indexed-agent/ui-index - Get current UI index',
          'GET /api/ui-indexed-agent/ui-index/search - Search UI elements',
          'POST /api/ui-indexed-agent/execute-task - Execute task using UI index',
          'POST /api/ui-indexed-agent/validate-task - Validate task feasibility',
          'DELETE /api/ui-indexed-agent/ui-index/cache - Clear UI index cache',
          'GET /api/ui-indexed-agent/active-apps - Get active applications',
          'POST /api/ui-indexed-agent/cleanup - Cleanup stale UI elements'
        ]
      },
      users: {
        path: '/api/users',
        description: 'User-centric persistent memory and agent association for Thinkdrop AI Personal Intelligence Layer',
        endpoints: [
          'POST /api/users - Create new user',
          'GET /api/users/{userId} - Get user by ID',
          'GET /api/users/email/{email} - Get user by email',
          'PUT /api/users/{userId} - Update user',
          'GET /api/users/{userId}/memories - Get user memories with filtering',
          'POST /api/users/{userId}/memories - Create user memory',
          'GET /api/users/{userId}/memories/{memoryId} - Get specific memory',
          'PUT /api/users/{userId}/memories/{memoryId} - Update memory',
          'DELETE /api/users/{userId}/memories/{memoryId} - Delete memory',
          'GET /api/users/{userId}/agents - Get user-agent associations',
          'POST /api/users/{userId}/agents - Create user-agent association',
          'PUT /api/users/{userId}/agents/{agentId} - Update agent association',
          'DELETE /api/users/{userId}/agents/{agentId} - Remove agent association',
          'GET /api/users/{userId}/context - Get enriched user context',
          'POST /api/users/{userId}/enrich-prompt - Enrich prompt with user context'
        ]
      },
      streaming: {
        path: '/api/streaming',
        description: 'Low-latency streaming responses with live progress updates',
        endpoints: [
          'POST /api/streaming/ask - Stream LLM responses with live progress',
          'POST /api/streaming/quick - Ultra-fast cached responses for common queries'
        ]
      },
      'automation-analytics': {
        path: '/api/automation-analytics',
        description: 'Automation session logging and analytics',
        endpoints: [
          'GET /api/automation-analytics/sessions - Get automation sessions with filtering',
          'GET /api/automation-analytics/sessions/{sessionId} - Get specific session details',
          'DELETE /api/automation-analytics/sessions/{sessionId} - Delete session and logs',
          'POST /api/automation-analytics/cleanup - Cleanup old sessions',
          'GET /api/automation-analytics/stats - Get automation statistics',
          'GET /api/automation-analytics/performance - Get performance metrics'
        ]
      },
      'enhanced-visual-agent': {
        path: '/api/enhanced-visual-agent',
        description: 'Enhanced visual agent with robust app navigation and multi-step automation',
        endpoints: [
          'POST /api/enhanced-visual-agent/execute-task - Execute task with app navigation',
          'GET /api/enhanced-visual-agent/health - Get enhanced agent health status',
          'POST /api/enhanced-visual-agent/verify-app - Verify if specific app is focused'
        ]
      },
      orchestration: {
        path: '/api/orchestration',
        description: 'Thinkdrop AI Drops Orchestration System - Multi-agent workflow management',
        endpoints: [
          'GET /api/orchestration/health - Health check endpoint',
          'POST /api/orchestration/workflows - Create new orchestration workflow',
          'GET /api/orchestration/workflows - List user workflows with pagination',
          'GET /api/orchestration/workflows/{id} - Get specific workflow by ID',
          'PUT /api/orchestration/workflows/{id} - Update existing workflow',
          'DELETE /api/orchestration/workflows/{id} - Delete workflow',
          'GET /api/orchestration/workflows/{id}/logs - Get workflow execution logs',
          'POST /api/orchestration/workflows/{id}/logs - Add execution log entry',
          'POST /api/orchestration/workflows/{id}/execute - Execute workflow',
          'POST /api/orchestration/templates - Create workflow template from existing workflow'
        ]
      },
      drops: {
        path: '/api/drops',
        description: 'DropRegistry - Agent capability catalog and discovery system',
        endpoints: [
          'GET /api/drops/health - Health check for DropRegistry service',
          'POST /api/drops/search - Search for Drops (Agents) based on criteria',
          'POST /api/drops/find-best - Find the best Drop for a specific task',
          'POST /api/drops/register - Register a new Drop with capability analysis',
          'GET /api/drops/stats - Get Drop registry statistics'
        ]
      },
      nutjs: {
        path: '/api/nutjs',
        description: 'Nut.js code generation for desktop automation (Grok + Claude)',
        endpoints: [
          'POST /api/nutjs - Generate Nut.js code from natural language command',
          'GET /api/nutjs/health - Health check for Nut.js code generation service',
          'GET /api/nutjs/examples - Get example commands and patterns'
        ]
      }
    },
    documentation: {
      swagger: '/api-docs',
      baseUrl: process.env.NODE_ENV === 'production' 
        ? (process.env.API_BASE_URL || 'https://api.bibscrip.com') 
        : 'http://localhost:4000'
    }
  });
});

// Mount routers
router.use('/bible', bibleRouter);
router.use('/vector', vectorRouter);
router.use('/cache', cacheRouter);
router.use('/generate', generateRouter);
router.use('/ask', askRouter);
router.use('/llm', llmRouter);
router.use('/youtube', youtubeRouter);
router.use('/auth', authRouter);
router.use('/bibliography', bibliographyRouter);
router.use('/agents', agentsRouter);
router.use('/users', usersRouter);
router.use('/streaming', streamingRouter);
// Removed: /visual-agent and /integration endpoints (moved to Electron client)
router.use('/analytics', analyticsRouter);
router.use('/automation-analytics', automationAnalyticsRouter);
// Phase 1: Thinkdrop AI Drops Orchestration System
router.use('/orchestration', createOrchestrationWorkflowRoutes(pool));
// Phase 2: DropRegistry - Agent Capability Catalog
router.use('/drops', dropRegistryRouter);
// Nut.js Code Generation - Specialized LLM for desktop automation
router.use('/nutjs', nutjsRouter);

// All routers are explicitly imported and mounted above
// No need for dynamic mounting as it can cause route conflicts

export default router;
