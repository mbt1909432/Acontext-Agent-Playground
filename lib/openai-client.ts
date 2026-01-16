/**
 * OpenAI client wrapper for LLM interactions
 */

import OpenAI from "openai";
import type { ChatMessage, LLMConfig, ToolInvocation } from "@/types/chat";
import { runBrowserUseTask, streamBrowserUseTask } from "@/lib/browser-use";
import {
  executeAcontextDiskTool,
  isAcontextDiskToolName,
} from "@/lib/acontext-disk-tools";
import {
  runExperienceSearch,
  isExperienceSearchToolName,
} from "@/lib/acontext-experience-search-tool";
import {
  runTodo,
  isTodoToolName,
} from "@/lib/acontext-todo-tool";
import {
  runImageGenerate,
  isImageGenerateToolName,
} from "@/lib/acontext-image-generate-tool";

function safeToolResultToMessageContent(
  toolName: string,
  toolCallId: string,
  result: unknown,
  maxBytes: number = 9_500_000 // stay under common 10MB/provider limits
): string {
  // We must ensure tool message content doesn't exceed provider limits,
  // otherwise the *next* LLM call fails (e.g. 400 string too long).
  let json = "";
  try {
    json = JSON.stringify(result ?? {});
  } catch (e) {
    json = JSON.stringify({
      error: "Failed to stringify tool result",
      toolName,
      toolCallId,
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes <= maxBytes) return json;

  // Build a small summary instead of sending the full payload.
  const summary = {
    truncated: true,
    toolName,
    toolCallId,
    originalBytes: bytes,
    maxBytes,
    note:
      "Tool result was too large to include in the conversation. Base64 blobs or large raw payloads were omitted. Refer to saved artifacts/disk outputs instead.",
    preview: json.slice(0, 2000),
  };
  return JSON.stringify(summary);
}


/**
 * Creates an OpenAI client instance
 */
export function createOpenAIClient(config: LLMConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint,
  });
}

/**
 * Converts ChatMessage array to OpenAI format
 * Supports Vision API format (content as array) for images
 */
function messagesToOpenAIFormat(
  messages: ChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return {
        role: "system",
        content: typeof msg.content === "string" ? msg.content : String(msg.content),
      };
    }
    if (msg.role === "user") {
      // Support Vision API format: content can be string or array
      // Array format: [{ type: "text", text: "..." }, { type: "image_url", image_url: { url: "..." } }]
      if (Array.isArray(msg.content)) {
        return {
          role: "user",
          // OpenAI accepts array for Vision API; avoid `any` to satisfy lint.
          content:
            msg.content as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[],
        };
      }
      return {
        role: "user",
        content: typeof msg.content === "string" ? msg.content : String(msg.content),
      };
    }
    // assistant role
    return {
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : String(msg.content),
    };
  });
}

/**
 * Executes a tool call
 * @param toolCall - The tool call to execute
 * @param diskId - Optional disk ID for Acontext disk tools
 * @param acontextSessionId - Optional Acontext session ID for session-related tools
 * @param userId - Optional user ID for experience search tool
 * @param sessionId - Optional session ID for todo tool
 */
async function executeToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  diskId?: string,
  acontextSessionId?: string,
  userId?: string,
  sessionId?: string
): Promise<unknown> {
  if (toolCall.type !== "function" || !toolCall.function) {
    throw new Error(`Unsupported tool call type: ${toolCall.type}`);
  }

  const { name, arguments: argsJson } = toolCall.function;

  if (name === "browser_use_task") {
    const args = JSON.parse(argsJson || "{}");
    console.log("[openai-client] executeToolCall: calling runBrowserUseTask with task:", args.task);
    const result = await runBrowserUseTask({
      task: typeof args.task === "string" ? args.task : "",
    });
    console.log("[openai-client] executeToolCall: runBrowserUseTask returned:", JSON.stringify(result, null, 2).substring(0, 500));
    return result;
  }

  if (isExperienceSearchToolName(name)) {
    if (!userId) {
      throw new Error("User ID is required for experience_search tool");
    }
    const args = JSON.parse(argsJson || "{}");
    console.log("[openai-client] executeToolCall: calling runExperienceSearch with query:", args.query);
    const result = await runExperienceSearch(args, userId);
    console.log("[openai-client] executeToolCall: runExperienceSearch returned:", JSON.stringify(result, null, 2).substring(0, 500));
    return result;
  }

  if (isTodoToolName(name)) {
    if (!sessionId) {
      throw new Error("Session ID is required for todo tool");
    }
    const args = JSON.parse(argsJson || "{}");
    console.log("[openai-client] executeToolCall: calling runTodo with action:", args.action);
    const result = await runTodo(args, sessionId);
    console.log("[openai-client] executeToolCall: runTodo returned:", JSON.stringify(result, null, 2).substring(0, 500));
    return result;
  }

  if (isAcontextDiskToolName(name)) {
    const args = JSON.parse(argsJson || "{}");
    return executeAcontextDiskTool(name, args, diskId);
  }

  if (isImageGenerateToolName(name)) {
    const args = JSON.parse(argsJson || "{}");
    return runImageGenerate(args, diskId);
  }

  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Streams a Browser Use task call, yielding step updates
 */
export async function* streamBrowserUseToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): AsyncGenerator<
  { type: "step" | "complete"; taskId?: string; step?: unknown; result?: unknown },
  unknown,
  unknown
> {
  if (toolCall.type !== "function" || !toolCall.function) {
    throw new Error(`Unsupported tool call type: ${toolCall.type}`);
  }

  const { name, arguments: argsJson } = toolCall.function;

  if (name !== "browser_use_task") {
    throw new Error(`streamBrowserUseToolCall only supports browser_use_task`);
  }

  const args = JSON.parse(argsJson || "{}");
  const task = typeof args.task === "string" ? args.task : "";

  // Stream Browser Use task updates
  console.log("[openai-client] streamBrowserUseToolCall: starting stream for task:", task);
  for await (const update of streamBrowserUseTask({ task })) {
    console.log("[openai-client] streamBrowserUseToolCall: received update type:", (update as { type?: string })?.type);
    if (update && typeof update === "object" && "type" in update) {
      if (update.type === "step") {
        yield {
          type: "step",
          taskId: (update as { taskId?: string }).taskId,
          step: (update as { step?: unknown }).step,
        };
      } else if (update.type === "complete") {
        const completeUpdate = update as {
          taskId?: string;
          output?: unknown;
          raw?: unknown;
        };
        console.log("[openai-client] streamBrowserUseToolCall: complete update output:", JSON.stringify(completeUpdate.output, null, 2).substring(0, 500));
        const finalResult = completeUpdate.output ?? completeUpdate.raw ?? update;
        console.log("[openai-client] streamBrowserUseToolCall: returning final result:", JSON.stringify(finalResult, null, 2).substring(0, 500));
        // Use yield (not return) so callers using `for await` can receive the final result.
        yield {
          type: "complete",
          taskId: completeUpdate.taskId,
          result: finalResult,
        };
        return;
      }
    }
  }

}

/**
 * Performs chat completion with optional function calling support
 * Implements a loop mechanism that continues processing tool calls until a final response is received
 * @param diskId - Optional disk ID for Acontext disk tools
 * @param acontextSessionId - Optional Acontext session ID for session-related tools
 * @param userId - Optional user ID for experience search tool
 * @param sessionId - Optional session ID for todo tool
 * @param maxIterations - Maximum number of tool call iterations to prevent infinite loops (default: 10)
 */
export async function chatCompletion(
  client: OpenAI,
  messages: ChatMessage[],
  config: LLMConfig,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [],
  diskId?: string,
  acontextSessionId?: string,
  userId?: string,
  sessionId?: string,
  maxIterations: number = 10
): Promise<{
  message: string;
  toolCalls?: ToolInvocation[];
}> {
  const openAIMessages = messagesToOpenAIFormat(messages);
  const allToolCalls: ToolInvocation[] = [];
  let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = openAIMessages;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[chatCompletion] Iteration ${iteration}/${maxIterations}`);

    const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: config.model || "gpt-4.1",
      messages: currentMessages,
      temperature: config.temperature || 0.7,
      max_tokens: config.maxTokens || 1000,
    };

    // Add tools if enabled
    if (tools.length > 0) {
      completionParams.tools = tools;
      completionParams.tool_choice = "auto";
    }

    const completion = await client.chat.completions.create(completionParams);
    const assistantMessage = completion.choices[0]?.message;

    if (!assistantMessage) {
      throw new Error("No response from OpenAI");
    }

    // If there are no tool calls, return the final message
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`[chatCompletion] Final response received after ${iteration} iteration(s)`);
      return {
        message: assistantMessage.content || "",
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
    }

    // Handle tool calls - execute them and continue the loop
    console.log(`[chatCompletion] Processing ${assistantMessage.tool_calls.length} tool call(s)`);
    const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

    // Execute all tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const isFunctionCall = toolCall.type === "function" && !!toolCall.function;
      const fnName = isFunctionCall ? toolCall.function.name : "unknown";
      const fnArgs = isFunctionCall
        ? JSON.parse(toolCall.function.arguments || "{}")
        : {};

      try {
        if (!isFunctionCall) {
          allToolCalls.push({
            id: toolCall.id,
            name: fnName,
            arguments: fnArgs,
            error: `Unsupported tool call type: ${toolCall.type}`,
            invokedAt: new Date(),
          });
          continue;
        }

        const { name, arguments: argsJson } = toolCall.function;

        const result = await executeToolCall(toolCall, diskId, acontextSessionId, userId, sessionId);
        allToolCalls.push({
          id: toolCall.id,
          name,
          arguments: JSON.parse(argsJson || "{}"),
          result,
          invokedAt: new Date(),
        });

        toolResults.push({
          id: toolCall.id,
          type: "function",
          function: {
            name,
            arguments: argsJson,
          },
        });
      } catch (error) {
        allToolCalls.push({
          id: toolCall.id,
          name: fnName,
          arguments: fnArgs,
          error: error instanceof Error ? error.message : String(error),
          invokedAt: new Date(),
        });
      }
    }

    // Add assistant message and tool results to conversation for next iteration
    currentMessages = [
      ...currentMessages,
      assistantMessage,
      ...toolResults.map((toolCall) => ({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: safeToolResultToMessageContent(
          toolCall.type === "function" && toolCall.function
            ? toolCall.function.name
            : "unknown",
          toolCall.id,
          allToolCalls.find((tc) => tc.id === toolCall.id)?.result || {}
        ),
      })),
    ];

    // Continue loop to process next response
    console.log(`[chatCompletion] Tool calls executed, continuing loop...`);
  }

  // If we've reached max iterations, return the last assistant message if available
  console.warn(`[chatCompletion] Reached maximum iterations (${maxIterations}), returning accumulated tool calls`);
  return {
    message: "Maximum tool call iterations reached. Please try again with a more specific request.",
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
  };
}

/**
 * Performs chat completion with streaming support for Browser Use tasks
 * Implements a loop mechanism that continues processing tool calls until a final response is received
 * Returns an async generator that yields stream events
 * @param diskId - Optional disk ID for Acontext disk tools
 * @param acontextSessionId - Optional Acontext session ID for session-related tools
 * @param userId - Optional user ID for experience search tool
 * @param sessionId - Optional session ID for todo tool
 * @param maxIterations - Maximum number of tool call iterations to prevent infinite loops (default: 10)
 */
export async function* chatCompletionStream(
  client: OpenAI,
  messages: ChatMessage[],
  config: LLMConfig,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [],
  diskId?: string,
  acontextSessionId?: string,
  userId?: string,
  sessionId?: string,
  maxIterations: number = 10
): AsyncGenerator<
  | { type: "message"; content: string }
  | { type: "tool_call_start"; toolCall: ToolInvocation }
  | { type: "tool_call_step"; toolCallId: string; step: unknown }
  | { type: "tool_call_complete"; toolCall: ToolInvocation }
  | { type: "tool_call_error"; toolCall: ToolInvocation }
  | { type: "final_message"; message: string; toolCalls?: ToolInvocation[] },
  void,
  unknown
> {
  const openAIMessages = messagesToOpenAIFormat(messages);
  const allToolCalls: ToolInvocation[] = [];
  let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = openAIMessages;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[chatCompletionStream] Iteration ${iteration}/${maxIterations}`);

    const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: config.model || "gpt-4.1",
      messages: currentMessages,
      temperature: config.temperature || 0.7,
      max_tokens: config.maxTokens || 1000,
      stream: true, // Enable streaming for all responses
    };

    // Add tools if enabled
    if (tools.length > 0) {
      completionParams.tools = tools;
      completionParams.tool_choice = "auto";
    }

    const stream = await client.chat.completions.create(completionParams);

    console.log("[Stream] Starting stream processing...");

    let assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: "assistant",
      content: "",
      refusal: null,
    };
    let accumulatedContent = "";
    let toolCallsAccumulator: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }> = [];
    let chunkCount = 0;

    // Process streaming response
    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices[0]?.delta;
      
      if (!delta) {
        console.log(`[Stream] Chunk ${chunkCount}: No delta content`);
        continue;
      }

      // Accumulate content
      if (delta.content) {
        accumulatedContent += delta.content;
        console.log(`[Stream] Chunk ${chunkCount} - Content: "${delta.content}" (Total length: ${accumulatedContent.length})`);
        // Yield message chunks for streaming display
        yield { type: "message", content: delta.content };
        console.log(`[Stream] Chunk ${chunkCount} - Yielded message chunk`);
      }

      // Accumulate tool calls
      if (delta.tool_calls) {
        console.log(`[Stream] Chunk ${chunkCount} - Tool calls detected:`, JSON.stringify(delta.tool_calls, null, 2));
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index ?? 0;
          if (!toolCallsAccumulator[index]) {
            toolCallsAccumulator[index] = {
              id: toolCallDelta.id || "",
              type: "function",
              function: {
                name: toolCallDelta.function?.name || "",
                arguments: toolCallDelta.function?.arguments || "",
              },
            };
            console.log(`[Stream] Chunk ${chunkCount} - New tool call [${index}]: ${toolCallDelta.function?.name || "unknown"}`);
          } else {
            // Append to existing tool call
            const newArgs = toolCallDelta.function?.arguments || "";
            toolCallsAccumulator[index].function.arguments += newArgs;
            console.log(`[Stream] Chunk ${chunkCount} - Appending to tool call [${index}]: "${newArgs}"`);
          }
        }
      }
    }

    console.log(`[Stream] Stream completed. Total chunks: ${chunkCount}, Final content length: ${accumulatedContent.length}`);

    // Build final assistant message
    assistantMessage.content = accumulatedContent;
    if (toolCallsAccumulator.length > 0) {
      console.log(`[Stream] Building final message with ${toolCallsAccumulator.length} tool call(s)`);
      assistantMessage.tool_calls = toolCallsAccumulator
        .filter((tc) => tc.id && tc.function.name)
        .map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      console.log(`[Stream] Final tool calls:`, assistantMessage.tool_calls.map(tc => {
        if (tc.type === "function" && "function" in tc) {
          return { id: tc.id, name: tc.function.name };
        }
        return { id: tc.id, name: "unknown" };
      }));
    } else {
      console.log(`[Stream] Final message content: "${accumulatedContent.substring(0, 100)}${accumulatedContent.length > 100 ? '...' : ''}"`);
    }

    if (!assistantMessage.content && !assistantMessage.tool_calls?.length) {
      throw new Error("No response from OpenAI");
    }

    // If there are no tool calls, return the final message
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`[chatCompletionStream] Final response received after ${iteration} iteration(s)`);
      yield {
        type: "final_message",
        message: assistantMessage.content || "",
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
      return;
    }

    // Handle tool calls - execute them and continue the loop
    console.log(`[chatCompletionStream] Processing ${assistantMessage.tool_calls.length} tool call(s)`);
    const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

    // Execute all tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const isFunctionCall = toolCall.type === "function" && !!toolCall.function;
      const fnName = isFunctionCall ? toolCall.function.name : "unknown";
      const fnArgs = isFunctionCall
        ? JSON.parse(toolCall.function.arguments || "{}")
        : {};

      try {
        if (!isFunctionCall) {
          const errorToolCall: ToolInvocation = {
            id: toolCall.id,
            name: fnName,
            arguments: fnArgs,
            error: `Unsupported tool call type: ${toolCall.type}`,
            invokedAt: new Date(),
          };
          allToolCalls.push(errorToolCall);
          yield { type: "tool_call_error", toolCall: errorToolCall };
          continue;
        }

        const { name, arguments: argsJson } = toolCall.function;

        // Check if this is a Browser Use task that should be streamed
        if (name === "browser_use_task") {
          const toolCallInvocation: ToolInvocation = {
            id: toolCall.id,
            name,
            arguments: JSON.parse(argsJson || "{}"),
            invokedAt: new Date(),
          };

          // Emit tool call start
          yield { type: "tool_call_start", toolCall: toolCallInvocation };

          let finalResult: unknown = null;
          let taskId: string | undefined = undefined;

          try {
            console.log("[openai-client] chatCompletionStream: starting browser_use_task stream");
            // Stream Browser Use task execution
            for await (const update of streamBrowserUseToolCall(toolCall)) {
              console.log("[openai-client] chatCompletionStream: received update type:", update.type);
              if (update.type === "step") {
                // Emit step update
                yield {
                  type: "tool_call_step",
                  toolCallId: toolCall.id,
                  step: update.step,
                };
                if (update.taskId) {
                  taskId = update.taskId;
                }
              } else if (update.type === "complete") {
                finalResult = update.result;
                console.log("[openai-client] chatCompletionStream: complete update, finalResult:", JSON.stringify(finalResult, null, 2).substring(0, 500));
                if (update.taskId) {
                  taskId = update.taskId;
                }
              }
            }

            console.log("[openai-client] chatCompletionStream: stream finished, finalResult:", JSON.stringify(finalResult, null, 2).substring(0, 500));

            // Update tool call with result
            toolCallInvocation.result = finalResult;
            if (taskId && finalResult && typeof finalResult === "object") {
              (finalResult as { taskId?: string }).taskId = taskId;
            }
            allToolCalls.push(toolCallInvocation);

            console.log("[openai-client] chatCompletionStream: toolCallInvocation.result:", JSON.stringify(toolCallInvocation.result, null, 2).substring(0, 500));

            // Emit tool call complete
            yield { type: "tool_call_complete", toolCall: toolCallInvocation };

            toolResults.push({
              id: toolCall.id,
              type: "function",
              function: {
                name,
                arguments: argsJson,
              },
            });
          } catch (error) {
            toolCallInvocation.error =
              error instanceof Error ? error.message : String(error);
            allToolCalls.push(toolCallInvocation);
            yield { type: "tool_call_error", toolCall: toolCallInvocation };
          }
        } else {
          // Non-streaming tool call
          const toolCallInvocation: ToolInvocation = {
            id: toolCall.id,
            name,
            arguments: JSON.parse(argsJson || "{}"),
            invokedAt: new Date(),
          };

          yield { type: "tool_call_start", toolCall: toolCallInvocation };

          const result = await executeToolCall(toolCall, diskId, acontextSessionId, userId, sessionId);
          toolCallInvocation.result = result;
          allToolCalls.push(toolCallInvocation);

          yield { type: "tool_call_complete", toolCall: toolCallInvocation };

          toolResults.push({
            id: toolCall.id,
            type: "function",
            function: {
              name,
              arguments: argsJson,
            },
          });
        }
      } catch (error) {
        const errorToolCall: ToolInvocation = {
          id: toolCall.id,
          name: fnName,
          arguments: fnArgs,
          error: error instanceof Error ? error.message : String(error),
          invokedAt: new Date(),
        };
        allToolCalls.push(errorToolCall);
        yield { type: "tool_call_error", toolCall: errorToolCall };
      }
    }

    // Add assistant message and tool results to conversation for next iteration
    currentMessages = [
      ...currentMessages,
      assistantMessage,
      ...toolResults.map((toolCall) => {
        const toolCallResult = allToolCalls.find((tc) => tc.id === toolCall.id)?.result || {};
        console.log(`[openai-client] chatCompletionStream: sending tool result for ${toolCall.id}:`, JSON.stringify(toolCallResult, null, 2).substring(0, 500));
        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: safeToolResultToMessageContent(
            toolCall.type === "function" && toolCall.function
              ? toolCall.function.name
              : "unknown",
            toolCall.id,
            toolCallResult
          ),
        };
      }),
    ];

    // Continue loop to process next response
    console.log(`[chatCompletionStream] Tool calls executed, continuing loop...`);
  }

  // If we've reached max iterations, return accumulated tool calls
  console.warn(`[chatCompletionStream] Reached maximum iterations (${maxIterations})`);
  yield {
    type: "final_message",
    message: "Maximum tool call iterations reached. Please try again with a more specific request.",
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
  };
}

