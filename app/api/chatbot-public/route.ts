/**
 * Chatbot Public API route handler (guest mode)
 *
 * - No Supabase auth check
 * - Uses per-browser guest identity (guestId from request, or fallback)
 * - Persists context in Acontext (session + disk) using derived guest IDs
 * - Tools: experience_search, todo, Acontext disk tools
 * - IMPORTANT: browser_use_task is NOT exposed in this route
 */

import { NextRequest, NextResponse } from "next/server";
import { getLLMConfig } from "@/lib/config";
import {
  createOpenAIClient,
  chatCompletion,
  chatCompletionStream,
} from "@/lib/openai-client";
import { getAcontextClient } from "@/lib/acontext-client";
import {
  uploadFileToAcontext,
  storeMessageInAcontext,
  getAcontextTokenCounts,
  loadMessagesFromAcontext,
} from "@/lib/acontext-integration";
import { getAcontextDiskToolSchemas } from "@/lib/acontext-disk-tools";
import { getExperienceSearchToolSchema } from "@/lib/acontext-experience-search-tool";
import { getTodoToolSchema } from "@/lib/acontext-todo-tool";
import { getImageGenerateToolSchema } from "@/lib/acontext-image-generate-tool";
import {
  formatErrorResponse,
  maskSensitiveInfo,
  maskToken,
} from "@/lib/chat-errors";
import type { ChatRequest, ChatResponse } from "@/types/chat";

const REQUEST_TIMEOUT_MS = 300000; // 5 minutes

// Simple guest ID sanitizer to avoid weird characters
function sanitizeGuestId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 64) || "anon";
}

function deriveGuestIds(guestId?: string) {
  const base = sanitizeGuestId(guestId || "anon");
  const userId = `guest-user-${base}`;
  const sessionId = `guest-session-${base}`;
  const diskId = `guest-disk-${base}`;
  return { userId, sessionId, diskId };
}

function getDefaultSystemPrompt(): string {
  // Reuse the same persona text as /api/chatbot but keep it local here to avoid cross-imports
  return `You are Aria Context, a female AI engineer and research lead at Acontext.

This is a PUBLIC DEMO session. The user may not be logged in.

Constraints:
- You DO NOT have access to browser automation tools in this mode.
- You CAN use Acontext tools like experience_search, todo, and disk tools as needed.
- Treat this as a temporary workspace scoped to this browser only.

Your primary goals:
1. Help the user explore Acontext capabilities safely in demo mode.
2. Use tools thoughtfully, but avoid actions that assume a persistent, authenticated identity.`;
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body: ChatRequest & { guestId?: string };
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        formatErrorResponse(
          new Error("Invalid request body"),
          false
        ),
        { status: 400 }
      );
    }

    if (!body.message || typeof body.message !== "string") {
      return NextResponse.json(
        formatErrorResponse(
          new Error("Message is required and must be a string"),
          false
        ),
        { status: 400 }
      );
    }

    if (body.message.length > 100000) {
      return NextResponse.json(
        formatErrorResponse(
          new Error("Message is too long (max 100000 characters)"),
          false
        ),
        { status: 400 }
      );
    }

    // Derive guest-based IDs (per-browser)
    const { userId, sessionId, diskId } = deriveGuestIds(body.guestId);

    // Load LLM configuration
    let llmConfig;
    try {
      llmConfig = getLLMConfig();
      
      // Log tokens (partially masked for security)
      console.log("[Chatbot Public] API Tokens:", {
        openaiApiKey: maskToken(llmConfig.apiKey),
        acontextApiKey: maskToken(process.env.ACONTEXT_API_KEY),
        imageGenApiKey: maskToken(process.env.IMAGE_GEN_API_KEY),
      });
    } catch (error) {
      return NextResponse.json(
        formatErrorResponse(
          error instanceof Error ? error : new Error("LLM configuration error"),
          false
        ),
        { status: 500 }
      );
    }

    // Create or load Acontext session directly using the derived guest session ID
    const acontextClient = await getAcontextClient();
    let acontextSessionId: string | undefined = undefined;
    let acontextDiskId: string | undefined = diskId;

    if (acontextClient) {
      try {
        // Try to get existing session by ID, or create a new one
        // For guest mode, we use the sessionId directly as the Acontext session ID
        // First, try to get messages from the session to see if it exists
        try {
          const existingMessages = await acontextClient.sessions.getMessages(sessionId, {
            format: "openai",
            limit: 1,
          });
          // If we can get messages, the session exists
          acontextSessionId = sessionId;
        } catch {
          // Session doesn't exist, create a new one
          const newSession = await acontextClient.sessions.create({
            configs: {
              userId,
              sessionId,
              source: "nextjs-with-supabase-chatbot-public",
            },
          });
          acontextSessionId = newSession.id;
        }

        // Get or create disk for this session
        if (acontextSessionId) {
          try {
            // Try to get messages to see if session has a disk_id in metadata
            // If not, create a new disk
            const disk = await acontextClient.disks.create();
            acontextDiskId = disk.id;
          } catch {
            // If disk creation fails, continue with existing diskId
            console.warn("[Chatbot Public] Failed to create disk, using existing diskId");
          }
        }
      } catch (error) {
        console.warn("[Chatbot Public] Failed to create/get Acontext session:", error);
        // Continue without Acontext session - messages won't be persisted
        acontextSessionId = undefined;
      }
    }

    // Handle file uploads if any
    const attachmentInfo: Array<{
      filename: string;
      content: string; // base64
      mimeType: string;
    }> = [];

    if (body.attachments && body.attachments.length > 0) {
      for (const attachment of body.attachments) {
        try {
          const artifactPath = await uploadFileToAcontext(
            attachment.filename,
            attachment.content,
            attachment.mimeType,
            acontextDiskId
          );

          attachmentInfo.push({
            filename: attachment.filename,
            content: attachment.content,
            mimeType: attachment.mimeType,
          });

          if (artifactPath) {
            console.debug("[Chatbot Public] Attachment uploaded to Acontext:", {
              filename: attachment.filename,
              artifactPath,
            });
          }
        } catch (error) {
          console.warn(
            "[Chatbot Public] Failed to upload attachment:",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // Prepare messages: load from Acontext to preserve image formats, add system prompt on top
    const messages: Array<{
      role: "user" | "assistant" | "system";
      content: any;
    }> = [];

    let systemPrompt = body.systemPrompt || getDefaultSystemPrompt();
    messages.push({
      role: "system",
      content: systemPrompt,
    });

    // Load messages from Acontext to ensure image formats are preserved
    // Fallback to body.messages if Acontext is not available or session is new
    if (acontextSessionId) {
      try {
        const acontextMessages = await loadMessagesFromAcontext(acontextSessionId);
        if (acontextMessages && acontextMessages.length > 0) {
          // Filter out system messages (we add our own)
          for (const msg of acontextMessages) {
            if (msg.role !== "system") {
              messages.push({
                role: msg.role,
                content: msg.content as any,
              });
            }
          }
        } else {
          // No messages in Acontext yet, fallback to body.messages if provided
          if (Array.isArray(body.messages)) {
            for (const msg of body.messages) {
              if (
                msg &&
                (msg.role === "user" || msg.role === "assistant") &&
                typeof msg.content !== "undefined"
              ) {
                messages.push({
                  role: msg.role,
                  content: msg.content as any,
                });
              }
            }
          }
        }
      } catch (error) {
        console.warn("[Chatbot Public] Failed to load messages from Acontext, falling back to body.messages:", error);
        // Fallback to body.messages if Acontext load fails
        if (Array.isArray(body.messages)) {
          for (const msg of body.messages) {
            if (
              msg &&
              (msg.role === "user" || msg.role === "assistant") &&
              typeof msg.content !== "undefined"
            ) {
              messages.push({
                role: msg.role,
                content: msg.content as any,
              });
            }
          }
        }
      }
    } else {
      // No Acontext session, use body.messages
      if (Array.isArray(body.messages)) {
        for (const msg of body.messages) {
          if (
            msg &&
            (msg.role === "user" || msg.role === "assistant") &&
            typeof msg.content !== "undefined"
          ) {
            messages.push({
              role: msg.role,
              content: msg.content as any,
            });
          }
        }
      }
    }

    // Add new user message (with attachments if any)
    if (attachmentInfo.length > 0) {
      const hasImages = attachmentInfo.some((att) =>
        att.mimeType.startsWith("image/")
      );

      if (hasImages) {
        const contentParts: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [];

        if (body.message.trim()) {
          contentParts.push({
            type: "text",
            text: body.message,
          });
        }

        for (const att of attachmentInfo) {
          if (att.mimeType.startsWith("image/")) {
            const dataUrl = `data:${att.mimeType};base64,${att.content}`;
            contentParts.push({
              type: "image_url",
              image_url: { url: dataUrl },
            });
          } else {
            contentParts.push({
              type: "text",
              text: `\n[Attachment: ${att.filename} (${att.mimeType})]`,
            });
          }
        }

        messages.push({
          role: "user",
          content: contentParts as any,
        });
      } else {
        let messageContent = body.message;
        for (const att of attachmentInfo) {
          messageContent += `\n\n[Attachment: ${att.filename} (${att.mimeType})]`;
        }
        messages.push({
          role: "user",
          content: messageContent,
        });
      }
    } else {
      messages.push({
        role: "user",
        content: body.message,
      });
    }

    // Store user message in Acontext (assistant message stored on final_message)
    // For messages with images, store the complete Vision API format so images can be used as context
    const lastMessage = messages[messages.length - 1];

    if (acontextSessionId) {
      // Store the complete message content (including images in Vision API format)
      // This allows images to be used as context in subsequent messages
      if (Array.isArray(lastMessage?.content)) {
        // Store Vision API format directly (array with text and image_url)
        await storeMessageInAcontext(
          acontextSessionId,
          "user",
          lastMessage.content
        );
      } else {
        // Regular text message
        const userMessageContent =
          typeof lastMessage?.content === "string"
            ? lastMessage.content
            : body.message;
        await storeMessageInAcontext(
          acontextSessionId,
          "user",
          userMessageContent
        );
      }
    }

    // Create OpenAI client
    const client = createOpenAIClient(llmConfig);

    // Tools: same as /api/chatbot but WITHOUT browser_use_task
    const toolsEnabled = process.env.CHATBOT_ENABLE_TOOLS !== "false";
    const availableTools = toolsEnabled
      ? [
          getExperienceSearchToolSchema,
          getTodoToolSchema,
          getImageGenerateToolSchema,
          ...getAcontextDiskToolSchemas(),
        ]
      : [];

    const requestedToolNames = Array.isArray(body.enabledToolNames)
      ? Array.from(
          new Set(
            body.enabledToolNames
              .filter((name) => typeof name === "string")
              .map((name) => name.trim())
              .filter(Boolean)
          )
        )
      : undefined;

    const filteredTools = !toolsEnabled
      ? []
      : requestedToolNames
      ? requestedToolNames.length === 0
        ? []
        : availableTools.filter((tool) =>
            requestedToolNames.includes(
              tool.type === "function" ? tool.function.name : ""
            )
          )
      : availableTools;

    const shouldStream = body.stream !== false;

    if (shouldStream) {
      console.log("[API Public] Starting SSE stream...");
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          const sendEvent = (event: string, data: unknown) => {
            const message = `event: ${event}\ndata: ${JSON.stringify(
              data
            )}\n\n`;
            controller.enqueue(encoder.encode(message));
          };

          try {
            for await (const event of chatCompletionStream(
              client,
              messages,
              llmConfig,
              filteredTools,
              acontextDiskId,
              acontextSessionId,
              userId,
              sessionId
            )) {
              if (event.type === "message") {
                sendEvent("message", {
                  content: event.content,
                });
              } else if (event.type === "tool_call_start") {
                sendEvent("tool_call_start", {
                  toolCall: event.toolCall,
                });
              } else if (event.type === "tool_call_step") {
                sendEvent("tool_call_step", {
                  toolCallId: event.toolCallId,
                  step: event.step,
                });
              } else if (event.type === "tool_call_complete") {
                sendEvent("tool_call_complete", {
                  toolCall: event.toolCall,
                });
              } else if (event.type === "tool_call_error") {
                sendEvent("tool_call_error", {
                  toolCall: event.toolCall,
                });
              } else if (event.type === "final_message") {
                if (acontextSessionId) {
                  await storeMessageInAcontext(
                    acontextSessionId,
                    "assistant",
                    event.message
                  );
                }

                let tokenCounts:
                  | {
                      total_tokens: number;
                    }
                  | undefined;
                if (acontextSessionId) {
                  const counts = await getAcontextTokenCounts(
                    acontextSessionId
                  );
                  if (counts) {
                    tokenCounts = counts;
                  }
                }

                sendEvent("final_message", {
                  message: event.message,
                  sessionId,
                  toolCalls: event.toolCalls,
                  acontextDiskId,
                  tokenCounts,
                });

                controller.close();
                return;
              }
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            console.error("[API Public] Stream error:", errorMessage);
            sendEvent("error", {
              error: errorMessage,
            });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Non-streaming path
    const completionPromise = chatCompletion(
      client,
      messages,
      llmConfig,
      filteredTools,
      acontextDiskId,
      acontextSessionId,
      userId,
      sessionId
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Request timeout"));
      }, REQUEST_TIMEOUT_MS);
    });

    let completion;
    try {
      completion = await Promise.race([completionPromise, timeoutPromise]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("timeout")) {
        return NextResponse.json(
          formatErrorResponse(
            new Error("Request timeout - please try again"),
            false
          ),
          { status: 408 }
        );
      }
      throw error;
    }

    if (acontextSessionId) {
      await storeMessageInAcontext(
        acontextSessionId,
        "assistant",
        completion.message
      );
    }

    let tokenCounts: { total_tokens: number } | undefined;
    if (acontextSessionId) {
      const counts = await getAcontextTokenCounts(acontextSessionId);
      if (counts) {
        tokenCounts = counts;
      }
    }

    const response: ChatResponse = {
      message: completion.message,
      sessionId,
      toolCalls: completion.toolCalls,
      acontextDiskId,
      tokenCounts,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error(
      "Chatbot Public API error:",
      maskSensitiveInfo(String(error))
    );

    return NextResponse.json(formatErrorResponse(error, false), {
      status: 500,
    });
  }
}


