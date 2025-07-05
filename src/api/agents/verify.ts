import { Request, Response } from 'express';
import { AgentVerificationService, VerificationRequest } from '../../services/agentVerificationService';
import { logger } from '../../utils/logger';

const verificationService = new AgentVerificationService();

/**
 * POST /api/agents/verify
 * Verify and enrich agent code for completeness and functionality
 */
export const verifyAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      agentCode,
      agentMetadata,
      desiredBehavior,
      expectedParams,
      testCases
    } = req.body as VerificationRequest;

    // Validate required fields
    if (!agentCode || !agentMetadata?.name) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentCode and agentMetadata.name are required'
      });
      return;
    }

    logger.info('Agent verification requested', {
      agentName: agentMetadata.name,
      codeLength: agentCode.length,
      hasTestCases: !!(testCases && testCases.length > 0)
    });

    // Perform verification
    const verificationResult = await verificationService.verifyAgent({
      agentCode,
      agentMetadata,
      desiredBehavior,
      expectedParams,
      testCases
    });

    // Return results
    res.status(200).json({
      success: true,
      verification: verificationResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Agent verification failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    res.status(500).json({
      success: false,
      error: 'Agent verification failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * POST /api/agents/enrich
 * Auto-enrich agent code with missing implementations
 */
export const enrichAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      agentCode,
      agentMetadata,
      desiredBehavior,
      autoApply = false
    } = req.body;

    if (!agentCode || !agentMetadata?.name) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentCode and agentMetadata.name are required'
      });
      return;
    }

    logger.info('Agent enrichment requested', {
      agentName: agentMetadata.name,
      autoApply
    });

    // Run verification to get enrichment suggestions
    const verificationResult = await verificationService.verifyAgent({
      agentCode,
      agentMetadata,
      desiredBehavior
    });

    if (!verificationResult.success) {
      res.status(500).json({
        success: false,
        error: 'Verification failed',
        details: verificationResult.issues
      });
      return;
    }

    // Return enrichment results
    res.status(200).json({
      success: true,
      enrichment: {
        needsEnrichment: verificationResult.enrichmentSuggestions.length > 0,
        suggestions: verificationResult.enrichmentSuggestions,
        enrichedCode: verificationResult.finalAgentCode,
        modifications: verificationResult.modifications,
        issues: verificationResult.issues.filter(i => i.severity === 'high' || i.severity === 'critical')
      },
      verification: {
        verified: verificationResult.verified,
        dependencies: verificationResult.dependencies,
        secrets: verificationResult.secrets
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Agent enrichment failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      success: false,
      error: 'Agent enrichment failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * POST /api/agents/test
 * Test agent code in sandboxed environment
 */
export const testAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      agentCode,
      agentMetadata,
      testCases
    } = req.body;

    if (!agentCode || !testCases || !Array.isArray(testCases)) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentCode and testCases array are required'
      });
      return;
    }

    logger.info('Agent testing requested', {
      agentName: agentMetadata?.name || 'Unknown',
      testCaseCount: testCases.length
    });

    // Run verification with focus on testing
    const verificationResult = await verificationService.verifyAgent({
      agentCode,
      agentMetadata: agentMetadata || { name: 'TestAgent', description: 'Agent under test' },
      testCases
    });

    // Return test results
    res.status(200).json({
      success: true,
      testing: {
        testResults: verificationResult.testResults,
        allTestsPassed: verificationResult.testResults.every(t => t.passed),
        totalTests: verificationResult.testResults.length,
        passedTests: verificationResult.testResults.filter(t => t.passed).length,
        failedTests: verificationResult.testResults.filter(t => !t.passed).length
      },
      issues: verificationResult.issues,
      dependencies: verificationResult.dependencies,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Agent testing failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      success: false,
      error: 'Agent testing failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};
