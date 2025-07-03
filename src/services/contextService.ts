/**
 * Context Service for AI-aware bibliography integration
 * Provides context-enriched responses by injecting relevant bibliography data
 */

import { logger } from '../utils/logger';
import { vectorDbService } from './vectorDbService';

export interface ContextEntry {
  id: string;
  title: string;
  authors: string[];
  type: string;
  year?: number;
  abstract?: string;
  keywords: string[];
  relevanceScore: number;
  citation?: string;
}

export interface ContextRequest {
  query: string;
  userId: string;
  projectId?: string;
  maxResults?: number;
  minRelevanceScore?: number;
}

export interface ContextResponse {
  query: string;
  contextEntries: ContextEntry[];
  totalFound: number;
  contextSummary: string;
  suggestions: string[];
}

class ContextService {
  private readonly DEFAULT_MAX_RESULTS = 5;
  private readonly DEFAULT_MIN_RELEVANCE = 0.7;

  /**
   * Get context-aware bibliography entries for a given query
   */
  async getContextForQuery(request: ContextRequest): Promise<ContextResponse> {
    const {
      query,
      userId,
      projectId,
      maxResults = this.DEFAULT_MAX_RESULTS,
      minRelevanceScore = this.DEFAULT_MIN_RELEVANCE
    } = request;

    try {
      logger.info('Getting context for query', { query, userId, projectId });

      // TODO: Implement actual vector search against bibliography entries
      // For now, return mock context data
      const mockContextEntries: ContextEntry[] = [
        {
          id: 'bib_1',
          title: 'The Art of Computer Programming',
          authors: ['Donald E. Knuth'],
          type: 'book',
          year: 1968,
          abstract: 'A comprehensive multi-volume work on computer programming algorithms.',
          keywords: ['algorithms', 'computer science', 'programming'],
          relevanceScore: 0.92,
          citation: 'Knuth, D. E. (1968). The Art of Computer Programming. Addison-Wesley.'
        }
      ];

      const contextSummary = this.generateContextSummary(mockContextEntries, query);
      const suggestions = this.generateSuggestions(mockContextEntries, query);

      return {
        query,
        contextEntries: mockContextEntries,
        totalFound: mockContextEntries.length,
        contextSummary,
        suggestions
      };

    } catch (error) {
      logger.error('Error getting context for query:', {
        error: error instanceof Error ? error.message : String(error),
        query,
        userId
      });

      // Return empty context on error
      return {
        query,
        contextEntries: [],
        totalFound: 0,
        contextSummary: '',
        suggestions: []
      };
    }
  }

  /**
   * Enrich AI conversation with bibliography context
   */
  async enrichConversation(
    userMessage: string,
    userId: string,
    projectId?: string
  ): Promise<{
    enrichedPrompt: string;
    contextUsed: ContextEntry[];
    metadata: {
      originalMessage: string;
      contextCount: number;
      relevanceThreshold: number;
    };
  }> {
    try {
      const contextRequest: ContextRequest = {
        query: userMessage,
        userId,
        projectId,
        maxResults: 3, // Limit context for conversation enrichment
        minRelevanceScore: 0.75
      };

      const contextResponse = await this.getContextForQuery(contextRequest);

      let enrichedPrompt = userMessage;

      if (contextResponse.contextEntries.length > 0) {
        const contextSection = this.formatContextForPrompt(contextResponse.contextEntries);
        enrichedPrompt = `${userMessage}\n\n--- Relevant Bibliography Context ---\n${contextSection}`;
      }

      return {
        enrichedPrompt,
        contextUsed: contextResponse.contextEntries,
        metadata: {
          originalMessage: userMessage,
          contextCount: contextResponse.contextEntries.length,
          relevanceThreshold: 0.75
        }
      };

    } catch (error) {
      logger.error('Error enriching conversation:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        message: userMessage.substring(0, 100)
      });

      // Return original message on error
      return {
        enrichedPrompt: userMessage,
        contextUsed: [],
        metadata: {
          originalMessage: userMessage,
          contextCount: 0,
          relevanceThreshold: 0.75
        }
      };
    }
  }

  /**
   * Generate embeddings for bibliography entries
   */
  async indexBibliographyEntry(entry: {
    id: string;
    title: string;
    authors: string[];
    abstract?: string;
    keywords: string[];
    userId: string;
  }): Promise<boolean> {
    try {
      // Create searchable text from bibliography entry
      const searchableText = [
        entry.title,
        entry.authors.join(', '),
        entry.abstract || '',
        entry.keywords.join(', ')
      ].filter(Boolean).join(' ');

      // TODO: Use vectorDbService to store embedding
      // await vectorDbService.upsert([{
      //   id: `bib_${entry.id}`,
      //   values: embedding,
      //   metadata: {
      //     type: 'bibliography',
      //     userId: entry.userId,
      //     title: entry.title,
      //     authors: entry.authors,
      //     keywords: entry.keywords
      //   }
      // }]);

      logger.info('Bibliography entry indexed', { entryId: entry.id, userId: entry.userId });
      return true;

    } catch (error) {
      logger.error('Error indexing bibliography entry:', {
        error: error instanceof Error ? error.message : String(error),
        entryId: entry.id,
        userId: entry.userId
      });
      return false;
    }
  }

  /**
   * Remove bibliography entry from vector index
   */
  async removeBibliographyEntry(entryId: string, userId: string): Promise<boolean> {
    try {
      // TODO: Remove from vector database
      // await vectorDbService.deleteVectors([`bib_${entryId}`]);

      logger.info('Bibliography entry removed from index', { entryId, userId });
      return true;

    } catch (error) {
      logger.error('Error removing bibliography entry from index:', {
        error: error instanceof Error ? error.message : String(error),
        entryId,
        userId
      });
      return false;
    }
  }

  /**
   * Generate a summary of context entries
   */
  private generateContextSummary(entries: ContextEntry[], query: string): string {
    if (entries.length === 0) {
      return '';
    }

    const entryTypes = [...new Set(entries.map(e => e.type))];
    const yearRange = this.getYearRange(entries);
    const topKeywords = this.getTopKeywords(entries, 5);

    return `Found ${entries.length} relevant ${entryTypes.join(', ')} entries` +
           (yearRange ? ` spanning ${yearRange}` : '') +
           (topKeywords.length > 0 ? `. Key topics: ${topKeywords.join(', ')}.` : '.');
  }

  /**
   * Generate suggestions based on context entries
   */
  private generateSuggestions(entries: ContextEntry[], query: string): string[] {
    const suggestions: string[] = [];

    if (entries.length > 0) {
      // Suggest exploring related topics
      const keywords = this.getTopKeywords(entries, 3);
      if (keywords.length > 0) {
        suggestions.push(`Explore related topics: ${keywords.join(', ')}`);
      }

      // Suggest citing relevant works
      const recentWorks = entries
        .filter(e => e.year && e.year > 2010)
        .slice(0, 2);
      if (recentWorks.length > 0) {
        suggestions.push(`Consider citing: ${recentWorks.map(w => w.title).join(', ')}`);
      }

      // Suggest expanding search
      if (entries.length >= 5) {
        suggestions.push('Refine your search for more specific results');
      } else {
        suggestions.push('Broaden your search to find more relevant sources');
      }
    }

    return suggestions;
  }

  /**
   * Format context entries for AI prompt injection
   */
  private formatContextForPrompt(entries: ContextEntry[]): string {
    return entries.map((entry, index) => {
      return `[${index + 1}] ${entry.title} (${entry.authors.join(', ')}, ${entry.year || 'n.d.'})
Abstract: ${entry.abstract || 'No abstract available'}
Keywords: ${entry.keywords.join(', ')}
Relevance: ${(entry.relevanceScore * 100).toFixed(0)}%`;
    }).join('\n\n');
  }

  /**
   * Get year range from entries
   */
  private getYearRange(entries: ContextEntry[]): string | null {
    const years = entries
      .map(e => e.year)
      .filter((year): year is number => year !== undefined)
      .sort((a, b) => a - b);

    if (years.length === 0) return null;
    if (years.length === 1) return years[0].toString();

    const minYear = years[0];
    const maxYear = years[years.length - 1];
    return minYear === maxYear ? minYear.toString() : `${minYear}-${maxYear}`;
  }

  /**
   * Get top keywords from entries
   */
  private getTopKeywords(entries: ContextEntry[], limit: number): string[] {
    const keywordCounts = new Map<string, number>();

    entries.forEach(entry => {
      entry.keywords.forEach(keyword => {
        const normalizedKeyword = keyword.toLowerCase().trim();
        keywordCounts.set(normalizedKeyword, (keywordCounts.get(normalizedKeyword) || 0) + 1);
      });
    });

    return Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([keyword]) => keyword);
  }
}

export const contextService = new ContextService();
