/**
 * Unified streaming response types for WebSocket/voice layer
 * Built on top of existing REST API architecture
 */

export interface StreamingMessage {
  id: string;
  type: StreamingMessageType;
  payload: any;
  timestamp: number;
  parentId?: string; // For streaming chunks that belong to a parent message
  metadata?: StreamingMetadata;
}

export interface StreamingMetadata {
  source: 'local_llm' | 'backend_llm' | 'voice_service' | 'orchestration' | 'intent_evaluation';
  provider?: string; // Which LLM provider was used
  priority?: number; // 1-10, for message prioritization
  sessionId?: string;
  userId?: string;
  clientId?: string;
  confidence?: number; // For intent classification confidence
}

export enum StreamingMessageType {
  // Voice processing
  VOICE_STT_START = 'voice_stt_start',
  VOICE_STT_CHUNK = 'voice_stt_chunk',
  VOICE_STT_END = 'voice_stt_end',
  VOICE_TTS_REQUEST = 'voice_tts_request',
  VOICE_TTS_CHUNK = 'voice_tts_chunk',
  VOICE_TTS_END = 'voice_tts_end',
  
  // LLM streaming
  LLM_REQUEST = 'llm_request',
  LLM_STREAM_START = 'llm_stream_start',
  LLM_STREAM_CHUNK = 'llm_stream_chunk',
  LLM_STREAM_END = 'llm_stream_end',
  LLM_ERROR = 'llm_error',
  
  // Intent classification
  INTENT_CLASSIFICATION = 'intent_classification',
  
  // Conversation flow
  CONVERSATION_START = 'conversation_start',
  CONVERSATION_CHUNK = 'conversation_chunk',
  CONVERSATION_END = 'conversation_end',
  CONVERSATION_INTERRUPT = 'conversation_interrupt',
  
  // System messages
  HEARTBEAT = 'heartbeat',
  ERROR = 'error',
  CONNECTION_STATUS = 'connection_status',
  
  // Control messages
  INTERRUPT = 'interrupt',
  CANCEL = 'cancel',
  PAUSE = 'pause',
  RESUME = 'resume'
}

// Voice-specific types
export interface VoiceSTTChunk {
  audioData: string; // Base64 encoded audio chunk
  format: 'wav' | 'mp3' | 'webm';
  sampleRate: number;
  channels: number;
  duration: number; // in milliseconds
}

export interface VoiceSTTResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  language?: string;
  timestamp: number;
}

export interface VoiceTTSRequest {
  text: string;
  voice: string;
  speed: number;
  pitch: number;
  provider: 'elevenlabs' | 'openai' | 'local';
  options?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
  };
}

export interface VoiceTTSChunk {
  audioData: string; // Base64 encoded audio chunk
  format: 'wav' | 'mp3' | 'webm';
  sampleRate: number;
  channels: number;
  duration: number;
  isLast: boolean;
}

// LLM streaming types
export interface LLMStreamRequest {
  prompt: string;
  provider?: string; // Preferred provider
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    taskType?: string;
    responseLength?: 'short' | 'medium' | 'long'; // Control response length
    enableWebSearch?: boolean; // Enable web search for current information
  };
  context?: {
    recentContext?: Array<{ role: string; content: string; timestamp?: string; messageId?: string }>;
    sessionFacts?: Array<{ fact: string; confidence: number; timestamp?: string }>;
    sessionEntities?: Array<{ entity: string; type: string; value?: any }>;
    memories?: Array<{ content: string; relevance?: number; timestamp?: string }>;
    webSearchResults?: Array<{ title: string; snippet: string; url: string }>;
    systemInstructions?: string;
    sessionId?: string;
    userId?: string;
  };
}

export interface LLMStreamChunk {
  text: string;
  provider: string;
  tokenCount?: number;
  finishReason?: 'stop' | 'length' | 'content_filter' | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMStreamResult {
  fullText: string;
  provider: string;
  processingTime: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  fallbackChain?: Array<{
    provider: string;
    success: boolean;
    error?: string;
    latencyMs: number;
  }>;
}

// Conversation flow types
export interface ConversationContext {
  sessionId: string;
  userId?: string;
  conversationHistory: ConversationMessage[];
  currentTopic?: string;
  userPreferences?: Record<string, any>;
  localLLMCapabilities: string[];
  backendLLMCapabilities: string[];
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  source: 'voice' | 'text' | 'system';
  metadata?: {
    provider?: string;
    processingTime?: number;
    confidence?: number;
  };
}

export interface ConversationChunk {
  text: string;
  isComplete: boolean;
  source: 'local_llm' | 'backend_llm';
  provider?: string;
  confidence?: number;
  shouldSpeak?: boolean; // Whether this chunk should be converted to speech
}

// Error types
export interface StreamingError {
  code: string;
  message: string;
  details?: any;
  recoverable: boolean;
  provider?: string;
}

// Connection status
export interface ConnectionStatus {
  connected: boolean;
  lastHeartbeat: number;
  reconnectAttempts: number;
  latency: number;
  activeStreams: number;
}

// Unified response wrapper
export interface StreamingResponse<T = any> {
  success: boolean;
  data?: T;
  error?: StreamingError;
  metadata: StreamingMetadata;
}
