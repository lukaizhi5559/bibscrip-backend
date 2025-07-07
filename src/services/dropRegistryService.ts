/**
 * DropRegistry Service - Agent Capability Catalog
 * Formalizes agent discovery, capability matching, and orchestration planning
 * Phase 2: Production-ready agent registry for Thinkdrop AI Drops
 */

import { Pool } from 'pg';
import { Agent, AgentOrchestrationService } from './agentOrchestrationService';
import { logger } from '../utils/logger';

export interface DropCapability {
  id: string;
  name: string;
  description: string;
  category: 'automation' | 'communication' | 'data' | 'ai' | 'integration' | 'utility';
  tags: string[];
  requirements: string[];
  outputs: string[];
  complexity: 'low' | 'medium' | 'high';
  reliability: number; // 0.0-1.0
}

export interface DropSearchCriteria {
  query?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  maxComplexity?: 'low' | 'medium' | 'high';
  minReliability?: number;
  requiresDatabase?: boolean;
  executionTarget?: 'frontend' | 'backend';
}

export interface DropSearchResult {
  agent: Agent;
  score: number;
  matchReasons: string[];
  capabilities: DropCapability[];
  confidence: number;
}

export interface DropRegistryStats {
  totalDrops: number;
  categoryCounts: Record<string, number>;
  averageReliability: number;
  mostUsedCapabilities: Array<{ capability: string; count: number }>;
  recentlyAdded: Agent[];
}

export class DropRegistryService {
  private static instance: DropRegistryService;
  private pool: Pool;
  private orchestrationService: AgentOrchestrationService;

  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.orchestrationService = AgentOrchestrationService.getInstance();
  }

  public static getInstance(): DropRegistryService {
    if (!DropRegistryService.instance) {
      DropRegistryService.instance = new DropRegistryService();
    }
    return DropRegistryService.instance;
  }

  /**
   * Register a new Drop (Agent) with capability analysis
   */
  async registerDrop(agent: Agent): Promise<Agent> {
    try {
      logger.info(`Registering Drop: ${agent.name}`);
      
      // Analyze and enhance capabilities
      const enhancedAgent = await this.analyzeCapabilities(agent);
      
      // Store in database via orchestration service
      const storedAgent = await this.orchestrationService.storeAgent(enhancedAgent);
      
      logger.info(`Drop registered successfully: ${agent.name}`, {
        capabilities: enhancedAgent.capabilities,
        category: this.categorizeAgent(enhancedAgent)
      });
      
      return storedAgent;
    } catch (error) {
      logger.error(`Error registering Drop ${agent.name}:`, error as Error);
      throw new Error(`Failed to register Drop: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search for Drops based on criteria
   */
  async searchDrops(criteria: DropSearchCriteria): Promise<DropSearchResult[]> {
    try {
      logger.info('Searching Drops with criteria:', criteria);
      
      // Get all agents from database
      const allAgents = await this.orchestrationService.getAllAgents();
      
      // Filter and score agents based on criteria
      const results: DropSearchResult[] = [];
      
      for (const agent of allAgents) {
        const score = this.calculateMatchScore(agent, criteria);
        
        if (score > 0.1) { // Minimum threshold
          const capabilities = this.extractCapabilities(agent);
          const matchReasons = this.generateMatchReasons(agent, criteria);
          
          results.push({
            agent,
            score,
            matchReasons,
            capabilities,
            confidence: Math.min(score * 1.2, 1.0) // Boost confidence slightly
          });
        }
      }
      
      // Sort by score descending
      results.sort((a, b) => b.score - a.score);
      
      logger.info(`Found ${results.length} matching Drops`);
      return results.slice(0, 10); // Return top 10 results
      
    } catch (error) {
      logger.error('Error searching Drops:', error as Error);
      return [];
    }
  }

  /**
   * Find the best Drop for a specific task
   */
  async findBestDrop(taskDescription: string, context?: Record<string, any>): Promise<DropSearchResult | null> {
    try {
      logger.info(`Finding best Drop for task: ${taskDescription}`);
      
      // Use existing similarity search from orchestration service
      const similarAgent = await this.orchestrationService.findSimilarAgents(taskDescription);
      
      if (similarAgent) {
        const capabilities = this.extractCapabilities(similarAgent.agent);
        
        return {
          agent: similarAgent.agent,
          score: similarAgent.similarityScore,
          matchReasons: [
            `Description similarity: ${(similarAgent.matchDetails.descriptionSimilarity * 100).toFixed(1)}%`,
            `Match type: ${similarAgent.matchDetails.matchType}`
          ],
          capabilities,
          confidence: similarAgent.similarityScore
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Error finding best Drop:', error as Error);
      return null;
    }
  }

  /**
   * Get Drop registry statistics
   */
  async getRegistryStats(): Promise<DropRegistryStats> {
    try {
      const allAgents = await this.orchestrationService.getAllAgents();
      
      const categoryCounts: Record<string, number> = {};
      const capabilityUsage: Record<string, number> = {};
      let totalReliability = 0;
      
      for (const agent of allAgents) {
        // Count categories
        const category = this.categorizeAgent(agent);
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        
        // Count capabilities (with null check)
        const capabilities = agent.capabilities || [];
        for (const capability of capabilities) {
          capabilityUsage[capability] = (capabilityUsage[capability] || 0) + 1;
        }
        
        // Calculate reliability (based on complexity and dependencies)
        const reliability = this.calculateReliability(agent);
        totalReliability += reliability;
      }
      
      const mostUsedCapabilities = Object.entries(capabilityUsage)
        .map(([capability, count]) => ({ capability, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      const recentlyAdded = allAgents
        .sort((a, b) => (b.created_at?.getTime() || 0) - (a.created_at?.getTime() || 0))
        .slice(0, 5);
      
      return {
        totalDrops: allAgents.length,
        categoryCounts,
        averageReliability: allAgents.length > 0 ? totalReliability / allAgents.length : 0,
        mostUsedCapabilities,
        recentlyAdded
      };
    } catch (error) {
      logger.error('Error getting registry stats:', error as Error);
      throw new Error(`Failed to get registry stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze and enhance agent capabilities
   */
  private async analyzeCapabilities(agent: Agent): Promise<Agent> {
    const enhancedCapabilities = new Set(agent.capabilities);
    
    // Analyze code to infer capabilities
    const codeCapabilities = this.inferCapabilitiesFromCode(agent.code);
    codeCapabilities.forEach(cap => enhancedCapabilities.add(cap));
    
    // Analyze dependencies to infer capabilities
    const depCapabilities = this.inferCapabilitiesFromDependencies(agent.dependencies);
    depCapabilities.forEach(cap => enhancedCapabilities.add(cap));
    
    // Analyze description to infer capabilities
    const descCapabilities = this.inferCapabilitiesFromDescription(agent.description);
    descCapabilities.forEach(cap => enhancedCapabilities.add(cap));
    
    return {
      ...agent,
      capabilities: Array.from(enhancedCapabilities)
    };
  }

  /**
   * Infer capabilities from agent code
   */
  private inferCapabilitiesFromCode(code: string): string[] {
    const capabilities: string[] = [];
    const lowerCode = code.toLowerCase();
    
    // Desktop automation
    if (lowerCode.includes('@nut-tree/nut-js') || lowerCode.includes('screen') || lowerCode.includes('mouse') || lowerCode.includes('keyboard')) {
      capabilities.push('desktop_automation', 'ui_interaction');
    }
    
    // File operations
    if (lowerCode.includes('fs.') || lowerCode.includes('readfile') || lowerCode.includes('writefile')) {
      capabilities.push('file_operations', 'data_processing');
    }
    
    // Network requests
    if (lowerCode.includes('fetch') || lowerCode.includes('axios') || lowerCode.includes('http')) {
      capabilities.push('api_integration', 'network_requests');
    }
    
    // Database operations
    if (lowerCode.includes('sql') || lowerCode.includes('database') || lowerCode.includes('query')) {
      capabilities.push('database_operations', 'data_storage');
    }
    
    // AI/LLM integration
    if (lowerCode.includes('openai') || lowerCode.includes('llm') || lowerCode.includes('gpt')) {
      capabilities.push('ai_integration', 'text_processing');
    }
    
    return capabilities;
  }

  /**
   * Infer capabilities from dependencies
   */
  private inferCapabilitiesFromDependencies(dependencies: string[]): string[] {
    const capabilities: string[] = [];
    
    for (const dep of dependencies) {
      const lowerDep = dep.toLowerCase();
      
      if (lowerDep.includes('nut-tree')) capabilities.push('desktop_automation');
      if (lowerDep.includes('axios') || lowerDep.includes('fetch')) capabilities.push('api_integration');
      if (lowerDep.includes('fs') || lowerDep.includes('file')) capabilities.push('file_operations');
      if (lowerDep.includes('database') || lowerDep.includes('sql')) capabilities.push('database_operations');
      if (lowerDep.includes('telegram') || lowerDep.includes('discord')) capabilities.push('messaging');
      if (lowerDep.includes('email') || lowerDep.includes('smtp')) capabilities.push('email_integration');
      if (lowerDep.includes('openai') || lowerDep.includes('anthropic')) capabilities.push('ai_integration');
    }
    
    return capabilities;
  }

  /**
   * Infer capabilities from description
   */
  private inferCapabilitiesFromDescription(description: string): string[] {
    const capabilities: string[] = [];
    const lowerDesc = description.toLowerCase();
    
    // Communication
    if (lowerDesc.includes('email') || lowerDesc.includes('message') || lowerDesc.includes('notify')) {
      capabilities.push('communication', 'notifications');
    }
    
    // Automation
    if (lowerDesc.includes('automate') || lowerDesc.includes('schedule') || lowerDesc.includes('trigger')) {
      capabilities.push('automation', 'scheduling');
    }
    
    // Data processing
    if (lowerDesc.includes('process') || lowerDesc.includes('analyze') || lowerDesc.includes('extract')) {
      capabilities.push('data_processing', 'analysis');
    }
    
    // Integration
    if (lowerDesc.includes('integrate') || lowerDesc.includes('connect') || lowerDesc.includes('sync')) {
      capabilities.push('integration', 'data_sync');
    }
    
    return capabilities;
  }

  /**
   * Calculate match score for search criteria
   */
  private calculateMatchScore(agent: Agent, criteria: DropSearchCriteria): number {
    let score = 0;
    
    // Query matching (description and name)
    if (criteria.query) {
      const queryLower = criteria.query.toLowerCase();
      const nameLower = agent.name.toLowerCase();
      const descLower = agent.description.toLowerCase();
      
      if (nameLower.includes(queryLower)) score += 0.4;
      if (descLower.includes(queryLower)) score += 0.3;
      
      // Capability matching
      const agentCapabilities = agent.capabilities || [];
      for (const capability of agentCapabilities) {
        if (capability.toLowerCase().includes(queryLower)) score += 0.2;
      }
    }
    
    // Category matching
    if (criteria.category) {
      const agentCategory = this.categorizeAgent(agent);
      if (agentCategory === criteria.category) score += 0.3;
    }
    
    // Tag/capability matching
    if (criteria.capabilities) {
      const matchingCaps = criteria.capabilities.filter(cap => 
        agent.capabilities.some(agentCap => agentCap.toLowerCase().includes(cap.toLowerCase()))
      );
      score += (matchingCaps.length / criteria.capabilities.length) * 0.4;
    }
    
    // Execution target matching
    if (criteria.executionTarget && agent.execution_target === criteria.executionTarget) {
      score += 0.2;
    }
    
    // Database requirement matching
    if (criteria.requiresDatabase !== undefined && agent.requires_database === criteria.requiresDatabase) {
      score += 0.1;
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Categorize agent based on capabilities and description
   */
  private categorizeAgent(agent: Agent): string {
    const capabilities = (agent.capabilities || []).map(c => c.toLowerCase());
    const description = agent.description.toLowerCase();
    
    if (capabilities.some(c => c.includes('desktop') || c.includes('ui') || c.includes('automation'))) {
      return 'automation';
    }
    
    if (capabilities.some(c => c.includes('message') || c.includes('email') || c.includes('communication'))) {
      return 'communication';
    }
    
    if (capabilities.some(c => c.includes('data') || c.includes('database') || c.includes('file'))) {
      return 'data';
    }
    
    if (capabilities.some(c => c.includes('ai') || c.includes('llm') || c.includes('text'))) {
      return 'ai';
    }
    
    if (capabilities.some(c => c.includes('api') || c.includes('integration') || c.includes('sync'))) {
      return 'integration';
    }
    
    return 'utility';
  }

  /**
   * Extract capabilities as structured objects
   */
  private extractCapabilities(agent: Agent): DropCapability[] {
    const capabilities = agent.capabilities || [];
    return capabilities.map((capability, index) => ({
      id: `${agent.name}_${index}`,
      name: capability,
      description: `${capability} capability for ${agent.name}`,
      category: this.categorizeAgent(agent) as any,
      tags: [capability, agent.name.toLowerCase()],
      requirements: agent.dependencies,
      outputs: ['result', 'status'],
      complexity: agent.dependencies.length > 3 ? 'high' : agent.dependencies.length > 1 ? 'medium' : 'low',
      reliability: this.calculateReliability(agent)
    }));
  }

  /**
   * Calculate agent reliability score
   */
  private calculateReliability(agent: Agent): number {
    let reliability = 0.8; // Base reliability
    
    // Reduce reliability for complex agents
    const dependencies = agent.dependencies || [];
    const capabilities = agent.capabilities || [];
    
    if (dependencies.length > 5) reliability -= 0.2;
    if (agent.requires_database) reliability -= 0.1;
    
    // Increase reliability for well-documented agents
    if ((agent.description || '').length > 100) reliability += 0.1;
    if (capabilities.length > 3) reliability += 0.1;
    
    return Math.max(0.1, Math.min(1.0, reliability));
  }

  /**
   * Generate match reasons for search results
   */
  private generateMatchReasons(agent: Agent, criteria: DropSearchCriteria): string[] {
    const reasons: string[] = [];
    
    if (criteria.query) {
      if (agent.name.toLowerCase().includes(criteria.query.toLowerCase())) {
        reasons.push(`Name matches "${criteria.query}"`);
      }
      if (agent.description.toLowerCase().includes(criteria.query.toLowerCase())) {
        reasons.push(`Description contains "${criteria.query}"`);
      }
    }
    
    if (criteria.capabilities) {
      const agentCapabilities = agent.capabilities || [];
      const matchingCaps = criteria.capabilities.filter(cap => 
        agentCapabilities.some(agentCap => agentCap.toLowerCase().includes(cap.toLowerCase()))
      );
      if (matchingCaps.length > 0) {
        reasons.push(`Has capabilities: ${matchingCaps.join(', ')}`);
      }
    }
    
    if (criteria.executionTarget === agent.execution_target) {
      reasons.push(`Runs on ${agent.execution_target}`);
    }
    
    return reasons;
  }
}

// Export singleton instance
export const dropRegistryService = DropRegistryService.getInstance();
