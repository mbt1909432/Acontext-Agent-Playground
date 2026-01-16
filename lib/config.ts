/**
 * Environment configuration loader for LLM settings
 */

import type { LLMConfig } from "@/types/chat";

/**
 * Loads and validates LLM configuration from environment variables
 * @throws Error if required environment variables are missing
 */
export function getLLMConfig(): LLMConfig {
  const endpoint = process.env.OPENAI_LLM_ENDPOINT;
  const apiKey = process.env.OPENAI_LLM_API_KEY;

  if (!endpoint) {
    throw new Error(
      "OPENAI_LLM_ENDPOINT environment variable is not set. Please configure it in your .env.local file."
    );
  }

  if (!apiKey) {
    throw new Error(
      "OPENAI_LLM_API_KEY environment variable is not set. Please configure it in your .env.local file."
    );
  }

  return {
    endpoint,
    apiKey,
    model: process.env.OPENAI_LLM_MODEL || "gpt-4.1",
    temperature: process.env.OPENAI_LLM_TEMPERATURE
      ? parseFloat(process.env.OPENAI_LLM_TEMPERATURE)
      : 0.7,
    maxTokens: process.env.OPENAI_LLM_MAX_TOKENS
      ? parseInt(process.env.OPENAI_LLM_MAX_TOKENS, 10)
      : 1000,
  };
}

/**
 * Checks if LLM configuration is available without throwing
 */
export function hasLLMConfig(): boolean {
  try {
    getLLMConfig();
    return true;
  } catch {
    return false;
  }
}

