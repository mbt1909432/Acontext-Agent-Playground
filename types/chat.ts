/**
 * TypeScript types for Chatbot feature
 */

export interface ChatMessage {
  id?: string;
  sessionId?: string;
  role: "user" | "assistant" | "system";
  /**
   * Message content. Can be:
   * - string: Regular text message
   * - array: Vision API format for images
   *   [{ type: "text", text: "..." }, { type: "image_url", image_url: { url: "data:image/..." } }]
   */
  content: string | Array<    
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
  createdAt?: Date | string;
  toolCalls?: ToolInvocation[];
}

export interface ChatSession {
  id: string;
  
  userId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  title?: string;
  acontextSessionId?: string;
  acontextSpaceId?: string;
  acontextDiskId?: string;
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  invokedAt: Date | string;
  /**
   * Current step information for streaming tool calls (e.g., Browser Use)
   * @deprecated Use steps array instead for complete history
   */
  step?: unknown;
  /**
   * All step history for streaming tool calls (e.g., Browser Use)
   * Each step represents a progress update during tool execution
   */
  steps?: Array<unknown>;
}

export interface ChatError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  messages?: ChatMessage[];
  systemPrompt?: string;
  /**
   * Optional list of tool names the user allows for this request.
   * If empty/omitted, the server can disable tools entirely.
   */
  enabledToolNames?: string[];
  /**
   * Enable streaming response (default: true for Browser Use tasks)
   */
  stream?: boolean;
  /**
   * Optional file attachments (for Acontext artifacts)
   */
  attachments?: Array<{
    filename: string;
    content: string; // base64 encoded content
    mimeType: string;
  }>;
  /**
   * Enable semantic search in Acontext (default: true if Acontext is configured)
   */
  enableSemanticSearch?: boolean;
}

export interface ChatResponse {
  message: string;
  sessionId: string;
  toolCalls?: ToolInvocation[];
  acontextDiskId?: string;
  /**
   * Current token count for the session (from Acontext)
   * This helps users understand context window usage
   */
  tokenCounts?: {
    total_tokens: number;
  };
}

