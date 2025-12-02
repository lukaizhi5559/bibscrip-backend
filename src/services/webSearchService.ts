/**
 * Web Search Service
 * Provides current information from the web to enhance LLM responses
 */

import axios from 'axios';
import { logger } from '../utils/logger';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  relevanceScore?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  provider: string;
  totalResults: number;
  searchTime: number;
  success: boolean;
  error?: string;
}

export interface SearchOptions {
  maxResults?: number;
  language?: string;
  region?: string;
  timeFilter?: 'day' | 'week' | 'month' | 'year' | 'all';
  safeSearch?: boolean;
}

export class WebSearchService {
  private providers: string[] = ['brave', 'duckduckgo', 'serper', 'bing'];
  private fallbackEnabled: boolean = true;

  /**
   * Search the web for current information
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = performance.now();
    const { maxResults = 5, timeFilter = 'week' } = options;

    logger.info(`🔍 Web search initiated: "${query}" (max: ${maxResults}, time: ${timeFilter})`);

    // Try each provider in order until one succeeds
    for (const provider of this.providers) {
      try {
        const result = await this.searchWithProvider(provider, query, options);
        if (result.success && result.results.length > 0) {
          result.searchTime = performance.now() - startTime;
          logger.info(`✅ Web search successful with ${provider}: ${result.results.length} results in ${result.searchTime.toFixed(0)}ms`);
          return result;
        }
      } catch (error) {
        logger.warn(`❌ Web search failed with ${provider}:`, { 
          error: error instanceof Error ? error.message : String(error),
          query 
        });
        continue;
      }
    }

    // All providers failed
    const failedResult: SearchResponse = {
      results: [],
      query,
      provider: 'none',
      totalResults: 0,
      searchTime: performance.now() - startTime,
      success: false,
      error: 'All search providers failed'
    };

    logger.error('🚫 All web search providers failed', { query, searchTime: failedResult.searchTime });
    return failedResult;
  }

  /**
   * Search with specific provider
   */
  private async searchWithProvider(provider: string, query: string, options: SearchOptions): Promise<SearchResponse> {
    switch (provider) {
      case 'duckduckgo':
        return this.searchDuckDuckGo(query, options);
      case 'serper':
        return this.searchSerper(query, options);
      case 'brave':
        return this.searchBrave(query, options);
      case 'bing':
        return this.searchBing(query, options);
      default:
        throw new Error(`Unknown search provider: ${provider}`);
    }
  }

  /**
   * DuckDuckGo Instant Answer API (free, no API key required)
   */
  private async searchDuckDuckGo(query: string, options: SearchOptions): Promise<SearchResponse> {
    const { maxResults = 5 } = options;
    
    try {
      // Use DuckDuckGo HTML search (more reliable than instant answers)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });

      const results = this.parseDuckDuckGoHTML(response.data, maxResults);
      
      return {
        results,
        query,
        provider: 'duckduckgo',
        totalResults: results.length,
        searchTime: 0,
        success: true
      };
    } catch (error) {
      throw new Error(`DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Serper.dev Google Search API (requires API key)
   */
  private async searchSerper(query: string, options: SearchOptions): Promise<SearchResponse> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey || apiKey === 'your-serper-api-key') {
      throw new Error('Serper API key not configured');
    }

    const { maxResults = 5, timeFilter = 'week' } = options;

    try {
      const response = await axios.post('https://google.serper.dev/search', {
        q: query,
        num: maxResults,
        tbs: timeFilter !== 'all' ? this.getTimeFilter(timeFilter) : undefined
      }, {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const data = response.data;
      const results: SearchResult[] = (data.organic || []).map((item: any) => ({
        title: item.title || '',
        url: item.link || '',
        snippet: item.snippet || '',
        source: 'serper',
        publishedDate: item.date,
        relevanceScore: item.position ? 1 / item.position : 0.5
      }));

      return {
        results,
        query,
        provider: 'serper',
        totalResults: data.searchInformation?.totalResults || results.length,
        searchTime: 0,
        success: true
      };
    } catch (error) {
      throw new Error(`Serper search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Brave Search API (free tier available, requires API key)
   */
  private async searchBrave(query: string, options: SearchOptions): Promise<SearchResponse> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey || apiKey === 'your-brave-search-api-key') {
      throw new Error('Brave Search API key not configured');
    }

    const { maxResults = 5 } = options;

    try {
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: query,
          count: maxResults
        },
        headers: {
          'X-Subscription-Token': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      const data = response.data;
      const results: SearchResult[] = (data.web?.results || []).map((item: any) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.description || '',
        source: 'brave',
        publishedDate: item.age,
        relevanceScore: 0.8
      }));

      return {
        results,
        query,
        provider: 'brave',
        totalResults: results.length,
        searchTime: 0,
        success: true
      };
    } catch (error) {
      throw new Error(`Brave search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Bing Search API (requires API key)
   */
  private async searchBing(query: string, options: SearchOptions): Promise<SearchResponse> {
    const apiKey = process.env.BING_SEARCH_API_KEY;
    if (!apiKey || apiKey === 'your-bing-search-api-key') {
      throw new Error('Bing Search API key not configured');
    }

    const { maxResults = 5 } = options;

    try {
      const response = await axios.get('https://api.bing.microsoft.com/v7.0/search', {
        params: {
          q: query,
          count: maxResults,
          responseFilter: 'Webpages'
        },
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey
        },
        timeout: 10000
      });

      const data = response.data;
      const results: SearchResult[] = (data.webPages?.value || []).map((item: any) => ({
        title: item.name || '',
        url: item.url || '',
        snippet: item.snippet || '',
        source: 'bing',
        publishedDate: item.dateLastCrawled,
        relevanceScore: 0.8 // Bing doesn't provide position scores
      }));

      return {
        results,
        query,
        provider: 'bing',
        totalResults: data.webPages?.totalEstimatedMatches || results.length,
        searchTime: 0,
        success: true
      };
    } catch (error) {
      throw new Error(`Bing search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse DuckDuckGo HTML response (basic parsing)
   */
  private parseDuckDuckGoHTML(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    
    // Basic regex parsing for DuckDuckGo results
    // This is a simplified parser - in production you might want to use a proper HTML parser
    const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    
    let match;
    let count = 0;
    
    while ((match = resultRegex.exec(html)) !== null && count < maxResults) {
      results.push({
        title: this.decodeHTML(match[2]),
        url: match[1],
        snippet: this.decodeHTML(match[3]),
        source: 'duckduckgo',
        relevanceScore: 1 - (count * 0.1) // Simple relevance scoring
      });
      count++;
    }

    return results;
  }

  /**
   * Get time filter for search providers
   */
  private getTimeFilter(timeFilter: string): string {
    switch (timeFilter) {
      case 'day': return 'qdr:d';
      case 'week': return 'qdr:w';
      case 'month': return 'qdr:m';
      case 'year': return 'qdr:y';
      default: return '';
    }
  }

  /**
   * Decode HTML entities
   */
  private decodeHTML(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  /**
   * Determine if a query needs web search
   */
  static needsWebSearch(query: string): boolean {
    // Don't search if query is too long (likely a prompt, not a user query)
    if (query.length > 500) {
      return false;
    }

    const currentEventKeywords = [
      'today', 'yesterday', 'this week', 'this month', 'recent', 'latest', 'current',
      'news', 'breaking', 'update', 'happening', 'now', 'live',
      'stock price', 'weather', 'score', 'election', 'covid', 'pandemic',
      'what day is it', 'what time', 'when is', 'schedule', 'event',
      'who is', 'who are', 'what is', 'tell me about'
    ];

    const queryLower = query.toLowerCase();
    return currentEventKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Format search results for LLM context
   */
  static formatResultsForLLM(searchResponse: SearchResponse): string {
    if (!searchResponse.success || searchResponse.results.length === 0) {
      return 'No current web information available.';
    }

    let formatted = `\n\nCURRENT WEB INFORMATION (${searchResponse.provider}, ${searchResponse.results.length} results):\n`;
    
    searchResponse.results.forEach((result, index) => {
      formatted += `${index + 1}. **${result.title}**\n`;
      formatted += `   ${result.snippet}\n`;
      formatted += `   Source: ${result.url}\n`;
      if (result.publishedDate) {
        formatted += `   Published: ${result.publishedDate}\n`;
      }
      formatted += '\n';
    });

    formatted += `Search completed in ${searchResponse.searchTime.toFixed(0)}ms\n`;
    return formatted;
  }
}

// Export singleton instance
export const webSearchService = new WebSearchService();
