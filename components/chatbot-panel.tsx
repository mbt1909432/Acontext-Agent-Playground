"use client";

/**
 * ChatbotPanel component - Provides chatbot UI in protected pages
 */

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle, X, Send, Loader2, Plus, ChevronDown, ChevronUp, Wrench, Trash2, Paperclip, File, FolderOpen, AlertTriangle, FileText, ExternalLink, Download, Heart, Sparkles } from "lucide-react";
import type { ChatMessage, ChatResponse, ToolInvocation, ChatSession } from "@/types/chat";

interface ChatbotPanelProps {
  className?: string;
  /**
   * When true, renders a full-page chat experience instead of a floating widget.
   */
  fullPage?: boolean;
  /**
   * Optional custom system prompt/persona to send to the backend.
   * If omitted, the default Aria Context prompt on the server is used.
   */
  systemPrompt?: string;
  /**
   * Optional assistant display name (used in the chat UI).
   * Defaults to "Acontext Worker".
   */
  assistantName?: string;
  /**
   * Optional assistant avatar image src (Next.js Image src).
   * Defaults to the Acontext logo.
   */
  assistantAvatarSrc?: string;
}

type AvailableTool = {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description?: string;
    required: boolean;
  }[];
};

/**
 * Decode Unicode escape sequences in a string
 * Converts \u0041 to A, etc.
 */
function decodeUnicode(str: string): string {
  try {
    // First try to decode if it's a JSON string with Unicode escapes
    if (str.includes("\\u")) {
      // Replace Unicode escape sequences
      return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
      });
    }
    return str;
  } catch {
    return str;
  }
}

/**
 * Normalize message content (string or vision payload) into displayable text
 */
function normalizeMessageContent(
  content: ChatMessage["content"]
): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      return "[image]";
    })
    .join("\n");
}

/**
 * Render message content with support for images and links
 * Handles both string content and Vision API format (array with text and images)
 */
function renderMessageContent(content: ChatMessage["content"]): React.ReactNode {
  // If content is an array (Vision API format), render images and text
  if (Array.isArray(content)) {
    const parts: React.ReactNode[] = [];
    let key = 0;

    for (const item of content) {
      if (item.type === "text") {
        // Render text with links
        parts.push(
          <div key={`text-${key++}`} className="mb-2">
            {renderLinks(item.text)}
          </div>
        );
      } else if (item.type === "image_url") {
        // Render image
        parts.push(
          <div key={`image-${key++}`} className="mb-2">
            <img
              src={item.image_url.url}
              alt="Uploaded image"
              className="max-w-full h-auto rounded-lg border border-border"
              style={{ maxHeight: "400px" }}
            />
          </div>
        );
      }
    }

    return parts.length > 0 ? <>{parts}</> : null;
  }

  // If content is a string, render with links
  return renderLinks(content);
}

/**
 * Convert URLs and Markdown links in text to clickable links
 * Handles both Markdown format [text](url) and plain URLs
 */
function renderLinks(text: string): React.ReactNode {
  // First, handle Markdown links: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match;

  // Process Markdown links first
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index);
      parts.push(...renderPlainUrls(beforeText, key));
      key += beforeText.length;
    }

    // Add the clickable link
    const linkText = match[1];
    const linkUrl = match[2];
    parts.push(
      <a
        key={`link-${key++}`}
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
      >
        {linkText}
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text (which may contain plain URLs)
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    parts.push(...renderPlainUrls(remainingText, key));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

/**
 * Convert plain URLs in text to clickable links
 */
function renderPlainUrls(text: string, startKey: number = 0): React.ReactNode[] {
  // URL regex: matches http://, https://, or www. URLs
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = startKey;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{text.substring(lastIndex, match.index)}</span>
      );
    }

    // Add the clickable URL
    let url = match[0];
    // Add https:// if it's a www. URL
    if (url.startsWith("www.")) {
      url = "https://" + url;
    }
    parts.push(
      <a
        key={`url-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors break-all"
      >
        {match[0]}
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.substring(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : [<span key={startKey}>{text}</span>];
}

/**
 * Highlight keywords in text
 * Highlights common important keywords like: number, memory, evaluationPreviousGoal, nextGoal, url, actions, etc.
 */
function highlightKeywords(text: string): React.ReactNode {
  const keywords = [
    "number",
    "memory",
    "evaluationPreviousGoal",
    "nextGoal",
    "url",
    "screenshotUrl",
    "actions",
    "STEP",
    "Verdict",
    "Success",
    "Failure",
    "Error",
    "timeout",
    "done",
    "text",
    "success",
  ];

  // Split text by keywords while preserving the keywords
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // Create a regex pattern that matches any keyword (case-insensitive)
  // Match keywords that are JSON keys (followed by ":") or standalone words
  const escapedKeywords = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `("(${escapedKeywords.join("|")})"\\s*:)|(\\b(${escapedKeywords.join("|")})\\b)`,
    "gi"
  );

  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{text.substring(lastIndex, match.index)}</span>
      );
    }

    // Add the highlighted keyword
    parts.push(
      <span key={key++} className="font-semibold text-primary">
        {match[0]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.substring(lastIndex)}</span>);
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

/**
 * Format and display step content with Unicode decoding and keyword highlighting
 */
function formatStepContent(step: unknown): React.ReactNode {
  let content: string;
  
  if (typeof step === "string") {
    content = step;
  } else {
    content = JSON.stringify(step, null, 2);
  }

  // Decode Unicode escape sequences
  const decoded = decodeUnicode(content);
  
  // Highlight keywords
  return highlightKeywords(decoded);
}

/**
 * Tool Calls Display Component - Shows tool invocation details
 * Supports streaming display for Browser Use tasks
 */
function ToolCallsDisplay({ toolCalls, isFullPage = false }: { toolCalls: ToolInvocation[]; isFullPage?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  
  // Check if any tool call is a Browser Use task
  const browserUseCalls = toolCalls.filter(
    (tc) => tc.name === "browser_use_task" && tc.arguments?.task
  );

  if (isFullPage) {
    return (
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">
              Tools Invoked: {toolCalls.length}
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="space-y-3">
            {toolCalls.map((toolCall, idx) => {
              // Regular tool call display (Browser Use steps are handled via toolCall.step)
              return (
                <Card key={toolCall.id || idx}>
                  <CardContent className="pt-4 space-y-2">
                  {/* Tool Name */}
                  <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-primary">
                      {toolCall.name}
                    </span>
                    {toolCall.error && (
                        <span className="ml-auto text-xs text-destructive">
                          Error
                      </span>
                    )}
                  </div>

                  {/* Tool Arguments */}
                    <div className="rounded border bg-muted/50 p-2">
                      <div className="mb-1 text-xs text-muted-foreground">
                        Parameters:
                    </div>
                      <pre className="text-xs font-mono overflow-x-auto">
                      {JSON.stringify(toolCall.arguments, null, 2)}
                    </pre>
                  </div>

                  {/* Streaming Steps History (for Browser Use tasks) */}
                  {toolCall.steps && toolCall.steps.length > 0 && toolCall.result === undefined && !toolCall.error && (
                      <div className="rounded border bg-muted/50 p-2">
                        <div className="mb-2 text-xs text-muted-foreground">
                          Steps ({toolCall.steps.length}):
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {toolCall.steps.map((step, stepIdx) => (
                          <div
                            key={stepIdx}
                              className="rounded border bg-background/50 p-2"
                          >
                              <div className="mb-1 text-xs text-muted-foreground">
                                Step {stepIdx + 1}:
                            </div>
                              <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
                              {formatStepContent(step)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Fallback: Show single step if steps array is not available */}
                  {(!toolCall.steps || toolCall.steps.length === 0) && toolCall.step !== undefined && toolCall.result === undefined && !toolCall.error && (
                      <div className="rounded border bg-muted/50 p-2">
                        <div className="mb-1 text-xs text-muted-foreground">
                          Step:
                      </div>
                        <pre className="text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto">
                        {formatStepContent(toolCall.step)}
                      </pre>
                    </div>
                  )}

                  {/* Tool Result or Error */}
                  {toolCall.error ? (
                      <div className="rounded border border-destructive/50 bg-destructive/10 p-2">
                        <div className="mb-1 text-xs text-destructive">
                          Error:
                      </div>
                        <div className="text-xs font-mono text-destructive">{toolCall.error}</div>
                    </div>
                  ) : toolCall.result !== undefined && toolCall.result !== null ? (
                      <div className="rounded border bg-muted/50 p-2">
                        <div className="mb-1 text-xs text-muted-foreground">
                          Result:
                      </div>
                        <pre className="text-xs font-mono overflow-x-auto">
                        {formatStepContent(toolCall.result)}
                      </pre>
                    </div>
                  ) : toolCall.result === null ? (
                      <div className="rounded border border-yellow-500/50 bg-yellow-500/10 p-2">
                        <div className="mb-1 text-xs text-yellow-600 dark:text-yellow-400">
                          Result:
                      </div>
                        <div className="text-xs font-mono italic text-yellow-700 dark:text-yellow-300">null (No result returned)</div>
                    </div>
                  ) : null}

                  {/* Invocation Time */}
                  {toolCall.invokedAt && (
                    <div className="text-right">
                        <span className="text-xs text-muted-foreground">
                        {new Date(toolCall.invokedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Compact mode for floating widget
  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Used {toolCalls.length} tool(s)</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="space-y-2 text-xs">
          {toolCalls.map((toolCall, idx) => {
            // Regular tool call display (Browser Use steps are handled via toolCall.step)
            return (
              <div key={toolCall.id || idx} className="rounded border bg-muted/50 p-2 space-y-1">
                <div className="font-semibold text-primary">{toolCall.name}</div>
                <div>
                  <div className="text-muted-foreground">Parameters:</div>
                  <pre className="text-[10px] overflow-x-auto">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
                {/* Streaming Steps History (for Browser Use tasks) */}
                {toolCall.steps && toolCall.steps.length > 0 && toolCall.result === undefined && !toolCall.error && (
                  <div>
                    <div className="text-muted-foreground">Steps ({toolCall.steps.length}):</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {toolCall.steps.map((step, stepIdx) => (
                        <div key={stepIdx} className="rounded border bg-background/50 p-1.5">
                          <div className="text-[9px] text-muted-foreground mb-0.5">
                            Step {stepIdx + 1}:
                          </div>
                          <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap break-words">
                            {formatStepContent(step)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Fallback: Show single step if steps array is not available */}
                {(!toolCall.steps || toolCall.steps.length === 0) && toolCall.step !== undefined && toolCall.result === undefined && !toolCall.error && (
                  <div>
                    <div className="text-muted-foreground">Step:</div>
                    <pre className="text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
                      {formatStepContent(toolCall.step)}
                    </pre>
                  </div>
                )}
                {toolCall.error ? (
                  <div className="text-destructive">
                    <div className="text-muted-foreground">Error:</div>
                    <div>{toolCall.error}</div>
                  </div>
                ) : toolCall.result !== undefined && toolCall.result !== null ? (
                  <div>
                    <div className="text-muted-foreground">Result:</div>
                    <pre className="text-[10px] overflow-x-auto">
                      {formatStepContent(toolCall.result)}
                    </pre>
                  </div>
                ) : toolCall.result === null ? (
                  <div>
                    <div className="text-muted-foreground">Result:</div>
                    <div className="text-[10px] text-yellow-600 dark:text-yellow-400 italic">null (No result returned)</div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChatbotPanel({
  className,
  fullPage = false,
  systemPrompt,
  assistantName = "PPT Girl",
  assistantAvatarSrc = "/fonts/ppt_girl_chatbot.png",
}: ChatbotPanelProps) {
  const [isOpen, setIsOpen] = useState(fullPage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [acontextDiskId, setAcontextDiskId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [availableTools, setAvailableTools] = useState<AvailableTool[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [isToolsModalOpen, setIsToolsModalOpen] = useState(false);
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [files, setFiles] = useState<Array<{
    id?: string;
    path?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    createdAt?: string;
  }>>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filePreviews, setFilePreviews] = useState<Map<string, {
    content: string; // base64 for images, text for text files, or URL if isUrl is true
    mimeType: string;
    isLoading: boolean;
    error?: string;
    isUrl?: boolean; // true if content is a URL (publicUrl) instead of base64/text
    publicUrl?: string; // public URL for direct access to the file
  }>>(new Map());
  const [filePublicUrls, setFilePublicUrls] = useState<Map<string, string>>(new Map()); // Store publicUrl for each file
  // Track in-flight preview loads to avoid duplicate /artifacts/content requests
  const previewLoadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const [attachments, setAttachments] = useState<Array<{
    filename: string;
    content: string; // base64 for images/files, text content for text files
    mimeType: string;
    isTextFile?: boolean; // true if this is a text file with content read as text
  }>>([]);
  const [tokenCounts, setTokenCounts] = useState<{ total_tokens: number } | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingResponse, setPingResponse] = useState<string | null>(null);
  
  const handlePing = async () => {
    setPingLoading(true);
    setPingResponse(null);
    try {
      const res = await fetch("/api/acontext/healthcheck", {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPingResponse("pong");
      } else {
        setPingResponse("error");
      }
    } catch {
      setPingResponse("error");
    } finally {
      setPingLoading(false);
    }
  };
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Typewriter effect refs
  const typewriterBufferRef = useRef<Map<string, string>>(new Map()); // messageId -> buffered content
  const typewriterDisplayRef = useRef<Map<string, string>>(new Map()); // messageId -> displayed content
  const typewriterTimerRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map()
  ); // messageId -> timer
  const totalTools = availableTools.length;
  const enabledToolNames = availableTools.map((tool) => tool.name);
  const TOKEN_LIMIT_THRESHOLD = 80000;
  const TOKEN_WARNING_THRESHOLD = 70000;
  const tokenUsage = tokenCounts?.total_tokens ?? null;
  const isTokenWarning =
    tokenUsage !== null && tokenUsage >= TOKEN_WARNING_THRESHOLD;
  const isTokenCritical =
    tokenUsage !== null && tokenUsage >= TOKEN_LIMIT_THRESHOLD;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup typewriter timers on unmount
  useEffect(() => {
    return () => {
      typewriterTimerRef.current.forEach((timer) => clearInterval(timer));
      typewriterTimerRef.current.clear();
      typewriterBufferRef.current.clear();
      typewriterDisplayRef.current.clear();
    };
  }, []);

  // Auto-refresh files list every 5 seconds when acontextDiskId is available
  // This ensures the file list stays up-to-date with the remote Acontext disk
  useEffect(() => {
    if (!acontextDiskId) return;

    // Initial load when acontextDiskId becomes available
    handleLoadFiles();

    // Set up polling interval: refresh every 5 seconds
    const intervalId = setInterval(() => {
      // Only refresh if not currently loading to avoid overlapping requests
      if (!isFilesLoading) {
        handleLoadFiles();
      }
    }, 5000); // 5 seconds

    // Cleanup interval on unmount or when acontextDiskId changes
    return () => {
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acontextDiskId]);

  // Auto-load previews for previewable files when files list changes
  // This now works for both Files modal and right sidebar
  useEffect(() => {
    // Function to fetch publicUrl for a file (lightweight, should be much faster than full content)
    const fetchFilePublicUrl = async (file: {
      id?: string;
      path?: string;
      filename?: string;
      mimeType?: string;
    }) => {
      const fileKey = file.id || file.path || file.filename || "";
      if (!fileKey || !file.path) return;

      // Skip if already fetched
      if (filePublicUrls.has(fileKey)) return;

      try {
        const url = acontextDiskId
          ? `/api/acontext/artifacts/content?filePath=${encodeURIComponent(file.path)}&diskId=${encodeURIComponent(acontextDiskId)}&metaOnly=true`
          : `/api/acontext/artifacts/content?filePath=${encodeURIComponent(file.path)}&metaOnly=true`;

        const res = await fetch(url);
        if (!res.ok) return;

        const data = await res.json();
        if (data.success && data.publicUrl) {
          // Store public URL for download / external open
          setFilePublicUrls(prev => new Map(prev).set(fileKey, data.publicUrl));

          // Also create a lightweight preview entry for image files so that
          // the Files modal can render an inline preview without any extra
          // thumbnail artifacts being written to Acontext Disk.
          const mimeType = file.mimeType || "";
          const { isImage } = detectFileType(file.filename, mimeType);

          if (isImage) {
            setFilePreviews(prev => {
              const next = new Map(prev);
              const existing = next.get(fileKey);

              // Do not overwrite an existing or in-flight preview.
              if (existing && (existing.content || existing.isLoading)) {
                return next;
              }

              next.set(fileKey, {
                content: data.publicUrl,
                mimeType: mimeType || "image/*",
                isLoading: false,
                isUrl: true,
                publicUrl: data.publicUrl,
              });

              return next;
            });
          }
        }
      } catch (err) {
        console.error("[UI] Failed to fetch publicUrl for file", { fileKey, error: err });
      }
    };

    files.forEach((file) => {
      const fileKey = file.id || file.path || file.filename || "";
      if (!fileKey || !file.path) return;

      // Prefetch publicUrl metadata for all files (used for download links, etc.)
      // and, for images, populate a lightweight preview based on the publicUrl.
      fetchFilePublicUrl(file);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, filePreviews, filePublicUrls, acontextDiskId]);

  // Typewriter effect: gradually display buffered content
  const startTypewriter = (messageId: string, targetContent: string) => {
    // Clear existing timer for this message
    const existingTimer = typewriterTimerRef.current.get(messageId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Get current displayed content
    const currentDisplay = typewriterDisplayRef.current.get(messageId) || "";
    
    // If target is shorter than current, just update immediately
    if (targetContent.length <= currentDisplay.length) {
      typewriterDisplayRef.current.set(messageId, targetContent);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, content: targetContent } : msg
        )
      );
      return;
    }

    // Calculate how much new content to display
    const newContent = targetContent.slice(currentDisplay.length);
    
    // Typewriter settings: characters per interval, interval in ms
    // Adjust these values to control speed:
    // - Higher CHARS_PER_INTERVAL = faster display
    // - Lower INTERVAL_MS = smoother but more frequent updates
    // Current: ~60 chars/second (user-friendly speed)
    const CHARS_PER_INTERVAL = 2; // Display 2 characters at a time
    const INTERVAL_MS = 30; // Update every 30ms (~33 updates/second)
    
    let displayIndex = 0;
    
    const timer = setInterval(() => {
      displayIndex += CHARS_PER_INTERVAL;
      const newDisplay = currentDisplay + newContent.slice(0, displayIndex);
      
      // Update displayed content
      typewriterDisplayRef.current.set(messageId, newDisplay);
      
      // Update UI
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, content: newDisplay } : msg
        )
      );

      // If we've displayed all new content, clear the timer
      if (displayIndex >= newContent.length) {
        clearInterval(timer);
        typewriterTimerRef.current.delete(messageId);
        // Ensure final content is exactly targetContent
        typewriterDisplayRef.current.set(messageId, targetContent);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, content: targetContent } : msg
          )
        );
      }
    }, INTERVAL_MS);

    typewriterTimerRef.current.set(messageId, timer);
  };

  // Fetch chat sessions (for full-page layout)
  useEffect(() => {
    if (!fullPage) return;

    async function fetchSessions() {
      try {
        setIsSessionsLoading(true);
        const res = await fetch("/api/chat-sessions");
        if (!res.ok) {
          throw new Error("Failed to load sessions");
        }
        const data = await res.json();
        setSessions(data.sessions ?? []);
      } catch (err) {
        console.error("Failed to load chat sessions", err);
      } finally {
        setIsSessionsLoading(false);
      }
    }

    fetchSessions();
  }, [fullPage]);

  // Fetch available tools for display
  useEffect(() => {
    async function fetchTools() {
      try {
        const res = await fetch("/api/tools");
        if (!res.ok) {
          throw new Error("Failed to load tools");
        }
        const data = await res.json();
        const tools: AvailableTool[] = data.tools ?? [];
        setAvailableTools(tools);
        setToolsError(null);
      } catch (err) {
        setToolsError(
          err instanceof Error ? err.message : "Failed to load tools"
        );
      }
    }

    fetchTools();
  }, []);

  const handleLoadSessionMessages = async (targetSessionId: string) => {
    // Guard: block invalid session id on the client to avoid /api/chat-sessions/undefined/messages
    if (!targetSessionId) {
      setError("Failed to load messages: invalid session id");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`/api/chat-sessions/${targetSessionId}/messages`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to load messages");
      }
      const data = await res.json();
      setMessages(data.messages ?? []);
      setTokenCounts(data.tokenCounts ?? null);
      setSessionId(targetSessionId);
      
      // Extract acontextDiskId from the sessions list
      const session = sessions.find((s) => s.id === targetSessionId);
      if (session?.acontextDiskId) {
        setAcontextDiskId(session.acontextDiskId);
      } else {
        // Clear diskId if session doesn't have one
        setAcontextDiskId(undefined);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load session messages";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewSession = () => {
    // Reset local state so that next send will create a brand-new session on the server
    setMessages([]);
    setSessionId(undefined);
    setAcontextDiskId(undefined);
    setTokenCounts(null);
    setError(null);
    setInput("");
  };

  const handleDeleteSession = async (targetSessionId: string) => {
    if (!targetSessionId || deletingSessionId) return;

    const confirmed = window.confirm("Are you sure you want to delete this session? This action cannot be undone.");
    if (!confirmed) return;

    try {
      setDeletingSessionId(targetSessionId);
      setError(null);

      const res = await fetch(`/api/chat-sessions/${targetSessionId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to delete session");
      }

      // Remove from local list
      setSessions((prev) => prev.filter((s) => s.id !== targetSessionId));

      // If we deleted the active session, reset the chat view
      if (sessionId === targetSessionId) {
        setSessionId(undefined);
        setAcontextDiskId(undefined);
        setMessages([]);
        setTokenCounts(null);
        setInput("");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete session";
      setError(errorMessage);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Text file extensions to auto-read
    const textFileExtensions = ['.txt', '.md', '.tex', '.json', '.csv', '.log', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.sql', '.html', '.css', '.scss', '.sass', '.less', '.vue', '.svelte'];

    const newAttachments: Array<{
      filename: string;
      content: string;
      mimeType: string;
      isTextFile?: boolean;
    }> = [];

    for (const file of Array.from(files)) {
      try {
        const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        const isTextFile = textFileExtensions.includes(fileExtension) || 
                          file.type.startsWith('text/') ||
                          file.type === 'application/json' ||
                          file.type === 'application/xml';

        if (isTextFile) {
          // Read text file as text content
          const textContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve(reader.result as string);
            };
            reader.onerror = reject;
            reader.readAsText(file, 'UTF-8');
          });

          newAttachments.push({
            filename: file.name,
            content: textContent,
            mimeType: file.type || "text/plain",
            isTextFile: true,
          });
        } else {
          // Read non-text files as base64 (for images, etc.)
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:image/png;base64,")
            const base64Content = result.includes(",")
              ? result.split(",")[1]
              : result;
            resolve(base64Content);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newAttachments.push({
          filename: file.name,
          content: base64,
          mimeType: file.type || "application/octet-stream",
            isTextFile: false,
        });
        }
      } catch (error) {
        console.error("Failed to read file:", error);
        setError(`Failed to read file: ${file.name}`);
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLoadFiles = async () => {
    try {
      setIsFilesLoading(true);
      setFilesError(null);
      // Build URL with diskId query parameter if available
      const url = acontextDiskId
        ? `/api/acontext/artifacts?diskId=${encodeURIComponent(acontextDiskId)}`
        : "/api/acontext/artifacts";
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Failed to load files");
      }
      const data = await res.json();
      setFiles(data.artifacts || []);
    } catch (err) {
      setFilesError(
        err instanceof Error ? err.message : "Failed to load files"
      );
      setFiles([]);
    } finally {
      setIsFilesLoading(false);
    }
  };

  const handleOpenFilesModal = () => {
    setIsFilesModalOpen(true);
    if (files.length === 0) {
      handleLoadFiles();
    }
  };

  // Helper function to detect file type based on extension and MIME type
  const detectFileType = (filename?: string, mimeType?: string): { isImage: boolean; isText: boolean } => {
    const mime = mimeType || "";
    const name = filename || "";
    const ext = name.split('.').pop()?.toLowerCase() || "";
    
    // Image detection: check MIME type or extension
    const isImage = mime.startsWith("image/") || 
                   ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext);
    
    // Text detection: check MIME type or extension
    const isText = mime.startsWith("text/") ||
                   mime === "application/json" ||
                   mime === "application/javascript" ||
                   mime === "application/xml" ||
                   mime === "application/x-sh" ||
                   mime === "application/x-yaml" ||
                   mime === "application/yaml" ||
                   ["txt", "json", "js", "jsx", "ts", "tsx", "html", "css", "xml", "yaml", "yml", "md", "sh", "bash", "py", "java", "cpp", "c", "h", "go", "rs", "php", "rb", "swift", "kt"].includes(ext);
    
    return { isImage, isText };
  };

  const handleLoadFilePreview = async (file: {
    id?: string;
    path?: string;
    filename?: string;
    mimeType?: string;
  }) => {
    console.log("[UI] handleLoadFilePreview: Called with file", {
      file,
      fileId: file.id,
      filePath: file.path,
      filename: file.filename,
      mimeType: file.mimeType,
    });
    
    const fileKey = file.id || file.path || file.filename || "";
    if (!fileKey || !file.path) {
      console.warn("[UI] handleLoadFilePreview: Missing fileKey or file.path", {
        fileKey,
        filePath: file.path,
      });
      return;
    }

    // Check if already loaded or loading
    const existingPreview = filePreviews.get(fileKey);
    if (existingPreview && (existingPreview.content || existingPreview.isLoading)) {
      console.log("[UI] handleLoadFilePreview: Preview already exists or loading", {
        fileKey,
        hasContent: !!existingPreview.content,
        isLoading: existingPreview.isLoading,
      });
      return;
    }

    // If there is already an in-flight request for this file, reuse it instead of firing a new one
    const inFlight = previewLoadPromisesRef.current.get(fileKey);
    if (inFlight) {
      console.log("[UI] handleLoadFilePreview: Reusing in-flight preview load", { fileKey });
      await inFlight;
      return;
    }

    // Check if file is previewable (image or text)
    const mimeType = file.mimeType || "";
    const { isImage, isText } = detectFileType(file.filename, mimeType);

    console.log("[UI] handleLoadFilePreview: File type detection", {
      filename: file.filename,
      mimeType,
      isImage,
      isText,
      isPreviewable: isImage || isText,
    });

    if (!isImage && !isText) {
      console.log("[UI] handleLoadFilePreview: File is not previewable, skipping");
      return; // Don't preview non-image/non-text files
    }

    // Create and register a single in-flight promise for this fileKey
    const loadPromise = (async () => {
      // Set loading state
      setFilePreviews(prev => new Map(prev).set(fileKey, {
        content: "",
        mimeType: mimeType,
        isLoading: true,
      }));

      try {
        const safePath = file.path || "";
        const url = acontextDiskId
          ? `/api/acontext/artifacts/content?filePath=${encodeURIComponent(safePath)}&diskId=${encodeURIComponent(acontextDiskId)}`
          : `/api/acontext/artifacts/content?filePath=${encodeURIComponent(safePath)}`;
        
        console.log("[UI] handleLoadFilePreview: Fetching preview", {
          url,
          filePath: file.path,
          diskId: acontextDiskId,
        });
        
        const res = await fetch(url);
        
        console.log("[UI] handleLoadFilePreview: Fetch response", {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
        });
        if (!res.ok) {
          throw new Error("Failed to load file preview");
        }

        const data = await res.json();
        
        console.log("[UI] handleLoadFilePreview: API response data", {
          success: data.success,
          hasContent: !!data.content,
          hasPublicUrl: !!data.publicUrl,
          contentType: typeof data.content,
          contentLength: data.content?.length,
          reportedSize: data.size,
          mimeType: data.mimeType,
          contentPreview: data.content?.substring(0, 100),
        });
        
        if (!data.success) {
          throw new Error("Invalid response from server");
        }

        // Determine correct MIME type: use server's MIME type, or infer from extension if generic
        let finalMimeType = data.mimeType || mimeType;
        if (finalMimeType === "application/octet-stream" || !finalMimeType) {
          // Infer MIME type from file extension
          const ext = (file.filename || "").split('.').pop()?.toLowerCase() || "";
          const mimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            bmp: "image/bmp",
            ico: "image/x-icon",
            txt: "text/plain",
            json: "application/json",
            js: "application/javascript",
            jsx: "application/javascript",
            ts: "application/typescript",
            tsx: "application/typescript",
            html: "text/html",
            css: "text/css",
            xml: "application/xml",
            yaml: "application/yaml",
            yml: "application/yaml",
            md: "text/markdown",
            sh: "application/x-sh",
          };
          if (mimeMap[ext]) {
            finalMimeType = mimeMap[ext];
          }
        }

        const { isText: detectedIsText, isImage: detectedIsImage } = detectFileType(file.filename, finalMimeType);
        
        console.log("[UI] handleLoadFilePreview: File type detection", {
          filename: file.filename,
          finalMimeType,
          detectedIsText,
          detectedIsImage,
          contentLength: data.content?.length,
          reportedSize: data.size,
          hasPublicUrl: !!data.publicUrl,
        });
        
        // For images, prefer using publicUrl if available (more efficient and avoids base64 issues)
        if (detectedIsImage && data.publicUrl) {
          console.log("[UI] handleLoadFilePreview: Using publicUrl for image", {
            publicUrl: data.publicUrl,
          });
          setFilePreviews(prev => new Map(prev).set(fileKey, {
            content: data.publicUrl, // Store URL as content for images
            mimeType: finalMimeType,
            isLoading: false,
            isUrl: true, // Flag to indicate this is a URL, not base64 content
            publicUrl: data.publicUrl, // Store publicUrl for display
          }));
          return;
        }
        
        // Fallback to content if no publicUrl or not an image
        if (!data.content) {
          throw new Error("No content or publicUrl available");
        }

        // Validate content size for images
        if (detectedIsImage && data.size) {
          const minImageSize = 100; // Minimum reasonable size for an image (bytes)
          if (data.size < minImageSize) {
            console.warn("[UI] handleLoadFilePreview: Image file seems too small", {
              filename: file.filename,
              reportedSize: data.size,
              contentLength: data.content?.length,
              minImageSize,
            });
          }
        }
        
        // Handle content based on type:
        // - If isText: true, content is already a text string (no decoding needed)
        // - If isText: false or undefined, content is base64 encoded
        let content = data.content;
        
        // Check if backend returned text content directly (new format)
        const isTextContent = data.isText === true;
        
        // Only decode base64 if it's a text file and content is base64 encoded (old format or binary)
        if (detectedIsText && !detectedIsImage && !isTextContent) {
          // Backward compatibility: decode base64 for text files (old API format)
          try {
            // Decode base64 to binary string
            const binaryString = atob(data.content);
            // Convert binary string to Uint8Array (byte array)
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            // Decode UTF-8 bytes to text string
            const decoder = new TextDecoder('utf-8');
            content = decoder.decode(bytes);
            console.log("[UI] handleLoadFilePreview: Decoded base64 text content (backward compatibility)", {
              decodedLength: content.length,
              originalBase64Length: data.content.length,
            });
          } catch (e) {
            console.warn("[UI] Failed to decode text content:", e);
            content = data.content;
          }
        } else if (isTextContent) {
          // New format: content is already text, no decoding needed
          console.log("[UI] handleLoadFilePreview: Using direct text content (no base64 decoding)", {
            textLength: content.length,
          });
        } else {
          // For images and binary files, ensure content is a clean base64 string
          if (typeof content === 'string') {
            // Remove any whitespace characters
            content = content.replace(/\s/g, '');
          }
          
          // Validate base64 content length matches expected size
          if (detectedIsImage && data.size) {
            // Base64 encoding increases size by ~33%, so base64 length should be roughly 4/3 of original
            const expectedBase64Length = Math.ceil(data.size * 4 / 3);
            const actualBase64Length = content.length;
            const tolerance = 10; // Allow some tolerance
            
            if (Math.abs(actualBase64Length - expectedBase64Length) > tolerance) {
              console.warn("[UI] handleLoadFilePreview: Base64 content length mismatch", {
                filename: file.filename,
                reportedSize: data.size,
                expectedBase64Length,
                actualBase64Length,
                difference: actualBase64Length - expectedBase64Length,
              });
            }
          }
          
          console.log("[UI] handleLoadFilePreview: Keeping content as base64", {
            isImage: detectedIsImage,
            contentLength: content.length,
            reportedSize: data.size,
          });
        }

        setFilePreviews(prev => new Map(prev).set(fileKey, {
          content: content,
          mimeType: finalMimeType,
          isLoading: false,
          publicUrl: data.publicUrl, // Store publicUrl if available
        }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to load preview";
        // Use warn (not error) to avoid Next.js dev overlay "Console Error" for expected failures
        // (e.g. missing artifact, transient network issues). Also log stack explicitly because
        // the Next.js overlay often serializes `Error` as `{}`.
        console.warn("[UI] handleLoadFilePreview: Failed to load preview", {
          fileKey,
          filePath: file.path,
          filename: file.filename,
          errorMessage,
          errorStack: err instanceof Error ? err.stack : undefined,
        });
        
        setFilePreviews(prev => new Map(prev).set(fileKey, {
          content: "",
          mimeType: mimeType,
          isLoading: false,
          error: errorMessage,
        }));
      } finally {
        previewLoadPromisesRef.current.delete(fileKey);
      }
    })();

    previewLoadPromisesRef.current.set(fileKey, loadPromise);
    await loadPromise;
  };

  const handleManualCompress = async () => {
      if (!sessionId) {
      setError("An existing session is required to compress context");
      return;
    }

    try {
      setIsCompressing(true);
      setError(null);
      const res = await fetch(`/api/chat-sessions/${sessionId}/compress`, {
        method: "POST",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const message = errorData.message || "Failed to compress context";
        throw new Error(message);
      }

      const data = await res.json();

      // Clear any running typewriter timers to avoid stale updates
      typewriterTimerRef.current.forEach((timer) => clearInterval(timer));
      typewriterTimerRef.current.clear();
      typewriterBufferRef.current.clear();
      typewriterDisplayRef.current.clear();

      setMessages(data.messages ?? []);
      setTokenCounts(data.tokenCounts ?? null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to compress context";
      setError(errorMessage);
    } finally {
      setIsCompressing(false);
    }
  };

  // Helper function to convert text to base64
  const textToBase64 = (text: string): string => {
    // Use TextEncoder to handle Unicode properly
    const bytes = new TextEncoder().encode(text);
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const messageContent = input.trim();
    const currentAttachments = [...attachments];
    
    // Separate text files from other attachments
    const textFiles = currentAttachments.filter(att => att.isTextFile === true);
    const otherAttachments = currentAttachments.filter(att => att.isTextFile !== true);
    
    // Build text content including text files
    let textContentParts: string[] = [];
    if (messageContent.trim()) {
      textContentParts.push(messageContent);
    }
    
    // Add text file contents to message
    for (const textFile of textFiles) {
      textContentParts.push(`\n\n--- File: ${textFile.filename} ---\n${textFile.content}`);
    }
    
    const combinedTextContent = textContentParts.length > 0 
      ? textContentParts.join('') 
      : (otherAttachments.length > 0 ? "[Attachment]" : "");
    
    // Build user message content with attachments (Vision API format for images)
    let userMessageContent: ChatMessage["content"];
    if (otherAttachments.length > 0) {
      const hasImages = otherAttachments.some((att) =>
        att.mimeType.startsWith("image/")
      );

      if (hasImages) {
        // Use Vision API format: content as array with text and images
        const contentParts: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [];

        if (combinedTextContent.trim()) {
          contentParts.push({
            type: "text",
            text: combinedTextContent,
          });
        }

        for (const att of otherAttachments) {
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

        userMessageContent = contentParts;
      } else {
        // No images, use regular text format
        let finalTextContent = combinedTextContent || "[Attachment]";
        for (const att of otherAttachments) {
          finalTextContent += `\n\n[Attachment: ${att.filename} (${att.mimeType})]`;
        }
        userMessageContent = finalTextContent;
      }
    } else {
      userMessageContent = combinedTextContent || "[Attachment]";
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: userMessageContent,
    };

    // Add user message to UI immediately
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachments([]);
    setError(null);
    setIsLoading(true);

    try {
      const enabledToolsForRequest =
        availableTools.length > 0 ? enabledToolNames : undefined;

      // Prepare attachments for API: include both text files and other attachments
      // Convert text file content to base64 for API compatibility
      const attachmentsForAPI = [
        ...textFiles.map(att => ({
          filename: att.filename,
          content: textToBase64(att.content), // Convert text to base64
          mimeType: att.mimeType,
        })),
        ...otherAttachments.map(att => ({
          filename: att.filename,
          content: att.content, // Already base64
          mimeType: att.mimeType,
        })),
      ];

      const response = await fetch("/api/chatbot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: combinedTextContent || (attachmentsForAPI.length > 0 ? "[Attachment]" : ""),
          sessionId,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          // Optional custom system prompt/persona for specialized agents (e.g., PPT agent)
          systemPrompt: systemPrompt || undefined,
          enabledToolNames: enabledToolsForRequest,
          stream: true, // Enable streaming for Browser Use tasks
          attachments: attachmentsForAPI.length > 0 ? attachmentsForAPI : undefined,
        }),
      });

      if (!response.ok) {
        // Try to parse error as JSON, fallback to text
        let errorMessage = "Failed to get response";
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          errorMessage = await response.text().catch(() => errorMessage);
        }
        throw new Error(errorMessage);
      }

      // Check if response is streaming (SSE)
      const contentType = response.headers.get("content-type");
      const isStreaming = contentType?.includes("text/event-stream");

      if (isStreaming) {
        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentToolCalls: ToolInvocation[] = [];
        let finalMessage = "";
        let finalSessionId = sessionId;

        // Create a placeholder assistant message that will be updated
        const assistantMessageId = `assistant-${Date.now()}`;
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          toolCalls: [],
        };

        // Initialize typewriter buffers for this message
        typewriterBufferRef.current.set(assistantMessageId, "");
        typewriterDisplayRef.current.set(assistantMessageId, "");

        setMessages((prev) => [...prev, assistantMessage]);
        // Set loading to false once assistant message is added to avoid duplicate display
        setIsLoading(false);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "message";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data = line.slice(5).trim();
            } else if (line === "") {
              // Empty line indicates end of event
              if (data) {
                try {
                  const parsed = JSON.parse(data);

                  if (eventType === "message") {
                    // Stream message content chunks - buffer for typewriter effect
                    const content = parsed.content || "";
                    if (content) {
                      // Add to buffer
                      const currentBuffer = typewriterBufferRef.current.get(assistantMessageId) || "";
                      const newBuffer = currentBuffer + content;
                      typewriterBufferRef.current.set(assistantMessageId, newBuffer);
                      
                      // Start or update typewriter effect
                      startTypewriter(assistantMessageId, newBuffer);
                    }
                  } else if (eventType === "tool_call_start") {
                    const toolCall = parsed.toolCall as ToolInvocation;
                    currentToolCalls.push(toolCall);
                    // Update assistant message with tool calls
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, toolCalls: [...currentToolCalls] }
                          : msg
                      )
                    );
                  } else if (eventType === "tool_call_step") {
                    // Update the specific tool call with step information
                    // Accumulate steps in an array to preserve history
                    const { toolCallId, step } = parsed;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              toolCalls: msg.toolCalls?.map((tc) =>
                                tc.id === toolCallId
                                  ? {
                                      ...tc,
                                      step, // Keep current step for backward compatibility
                                      steps: [...(tc.steps || []), step], // Accumulate all steps
                                    }
                                  : tc
                              ),
                            }
                          : msg
                      )
                    );
                  } else if (eventType === "tool_call_complete") {
                    const toolCall = parsed.toolCall as ToolInvocation;
                    // Update the tool call in the list
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              toolCalls: msg.toolCalls?.map((tc) =>
                                tc.id === toolCall.id ? toolCall : tc
                              ),
                            }
                          : msg
                      )
                    );
                  } else if (eventType === "tool_call_error") {
                    const toolCall = parsed.toolCall as ToolInvocation;
                    // Update the tool call with error
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              toolCalls: msg.toolCalls?.map((tc) =>
                                tc.id === toolCall.id ? toolCall : tc
                              ),
                            }
                          : msg
                      )
                    );
                  } else if (eventType === "final_message") {
                    finalMessage = parsed.message || "";
                    finalSessionId = parsed.sessionId || sessionId;
                    // Store acontextDiskId if provided
                    if (parsed.acontextDiskId) {
                      setAcontextDiskId(parsed.acontextDiskId);
                    }
                    // Update token counts if provided
                    if (parsed.tokenCounts) {
                      setTokenCounts(parsed.tokenCounts);
                    }
                    // Update buffer with final message and ensure it's fully displayed
                    typewriterBufferRef.current.set(assistantMessageId, finalMessage);
                    // Start typewriter to display final message (or complete if already displayed)
                    startTypewriter(assistantMessageId, finalMessage);
                    // Also update tool calls immediately
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              toolCalls: parsed.toolCalls || msg.toolCalls,
                            }
                          : msg
                      )
                    );
                  } else if (eventType === "error") {
                    throw new Error(parsed.error || "Stream error");
                  }
                } catch (e) {
                  console.error("Failed to parse SSE data:", e);
                }
              }
              eventType = "message";
              data = "";
            }
          }
        }

        // Set session ID if this is the first message
        if (!sessionId && finalSessionId) {
          setSessionId(finalSessionId);

          // Refresh sessions list so that the new session appears in the sidebar
          if (fullPage) {
            (async () => {
              try {
                const res = await fetch("/api/chat-sessions");
                if (!res.ok) return;
                const data = await res.json();
                const refreshedSessions = data.sessions ?? [];
                setSessions(refreshedSessions);
                
                // Update acontextDiskId from refreshed session if available
                const refreshedSession = refreshedSessions.find((s: ChatSession) => s.id === finalSessionId);
                if (refreshedSession?.acontextDiskId) {
                  setAcontextDiskId(refreshedSession.acontextDiskId);
                }
              } catch (err) {
                console.error("Failed to refresh sessions", err);
              }
            })();
          }
        }
      } else {
        // Handle non-streaming response (fallback)
        const data: ChatResponse = await response.json();

        // Set session ID if this is the first message
        if (!sessionId && data.sessionId) {
          setSessionId(data.sessionId);
        }
        
        // Store acontextDiskId if provided
        if (data.acontextDiskId) {
          setAcontextDiskId(data.acontextDiskId);
        }
        // Update token counts if provided
        if (data.tokenCounts) {
          setTokenCounts(data.tokenCounts);
        }

          // Refresh sessions list so that the new session appears in the sidebar
          if (fullPage) {
            (async () => {
              try {
                const res = await fetch("/api/chat-sessions");
                if (!res.ok) return;
              const sessionData = await res.json();
              const refreshedSessions = sessionData.sessions ?? [];
              setSessions(refreshedSessions);
              
              // Update acontextDiskId from refreshed session if available
              if (data.sessionId) {
                const refreshedSession = refreshedSessions.find((s: ChatSession) => s.id === data.sessionId);
                if (refreshedSession?.acontextDiskId) {
                  setAcontextDiskId(refreshedSession.acontextDiskId);
                }
              }
              } catch (err) {
                console.error("Failed to refresh sessions", err);
              }
            })();
        }

        // Add assistant response
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: data.message,
          toolCalls: data.toolCalls,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);

      // Remove the user message on error so user can retry
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Floating widget mode (used on generic pages)
  if (!fullPage) {
    if (!isOpen) {
      return (
        <div className={className}>
          <Button
            onClick={() => setIsOpen(true)}
            className="fixed bottom-4 right-4 h-14 w-14 rounded-full shadow-lg sm:bottom-6 sm:right-6"
            size="icon"
          >
            <MessageCircle className="h-6 w-6" />
          </Button>
        </div>
      );
    }

    return (
      <div className={className}>
        <Card className="fixed bottom-4 left-1/2 z-50 flex h-[70vh] w-full max-w-md -translate-x-1/2 flex-col shadow-xl sm:bottom-6 sm:right-6 sm:left-auto sm:translate-x-0 sm:h-[600px] sm:w-96">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle>Chatbot</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <div
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  tokenUsage === null
                    ? "border-border text-muted-foreground"
                    : isTokenCritical
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : isTokenWarning
                    ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                    : "border-primary/60 bg-primary/10 text-primary"
                }`}
              >
                {tokenUsage === null
                  ? "Tokens pending"
                  : `${tokenUsage.toLocaleString()} tokens`}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualCompress}
                disabled={!sessionId || isCompressing}
                className="h-8 px-3 text-xs"
              >
                {isCompressing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Compress"}
              </Button>
            </div>
            {isTokenWarning && (
              <div className={`flex items-center gap-1 text-xs ${
                isTokenCritical ? "text-destructive" : "text-yellow-600 dark:text-yellow-400"
              }`}>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Context approaching limit, consider compressing</span>
              </div>
            )}
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-8">
                  Start a conversation by sending a message below.
                </div>
              )}
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-2.5 shadow-sm transition-all duration-200 relative overflow-hidden group ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground hover:shadow-md"
                        : "bg-muted border-l-4 border-primary/30"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary/60 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <ToolCallsDisplay toolCalls={message.toolCalls} isFullPage={false} />
                    )}
                    <div className="text-sm whitespace-pre-wrap relative z-10">
                      {renderMessageContent(message.content)}
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-4 py-2.5 border-l-4 border-primary/30 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Error message */}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                {error}
              </div>
            )}

            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((attachment, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg border-2 border-primary/40 bg-muted px-3 py-1.5 shadow-sm hover:shadow-md transition-shadow"
                  >
                    {attachment.isTextFile ? (
                      <FileText className="h-3 w-3 text-primary" />
                    ) : (
                    <File className="h-3 w-3 text-primary" />
                    )}
                    <span className="text-xs">
                      {attachment.filename}
                      {attachment.isTextFile && (
                        <span className="ml-1 text-muted-foreground">(read)</span>
                      )}
                    </span>
                    <button
                      onClick={() => handleRemoveAttachment(index)}
                      className="text-primary hover:text-primary/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input area */}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept="*/*"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                size="icon"
                variant="ghost"
                disabled={isLoading}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || isLoading}
                size="icon"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Full-page chat layout (used on /protected) - Futuristic style
  return (
    <div
      className={`relative flex h-full w-full min-h-0 overflow-hidden bg-background text-foreground ${className ?? ""}`}
    >
      {/* Left side: session list */}
      <aside className="relative hidden h-full w-64 flex-col justify-between border-r bg-card px-4 py-3 md:flex">
        <div className="space-y-4 overflow-y-auto pr-1">
          <Button
            className="w-full justify-start gap-2" 
            variant="outline"
            type="button"
            onClick={handleNewSession}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Session</span>
          </Button>
          <div className="space-y-3">
            <div className="px-1 text-xs text-muted-foreground">
              Session History
            </div>
            <div className="space-y-1.5">
              {isSessionsLoading && (
                <div className="px-1 text-xs text-muted-foreground">
                  Loading sessions...
                </div>
              )}
              {!isSessionsLoading && sessions.length === 0 && (
                <div className="px-1 text-xs text-muted-foreground">
                  No sessions yet. Start a new conversation.
                </div>
              )}
              {sessions.map((s) => {
                const isActive = s.id === sessionId;
                const createdAt =
                  typeof s.createdAt === "string"
                    ? new Date(s.createdAt)
                    : s.createdAt;
                const isDeleting = deletingSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`group flex w-full items-center gap-2 rounded-lg border-l-2 px-2.5 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "border-primary bg-accent"
                        : "border-border bg-card hover:bg-accent"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadSessionMessages(s.id)}
                      className="flex-1 text-left"
                    >
                      <div className="mb-0.5 line-clamp-2 text-xs font-medium">
                        {s.title || "Untitled Session"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {createdAt instanceof Date
                          ? createdAt.toLocaleString()
                          : String(createdAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s.id);
                      }}
                      className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground opacity-0 transition-all hover:border-destructive hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      aria-label="Delete session"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2 rounded-lg border bg-card px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-slow" />
              <span className="font-medium">Online</span>
            </span>
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-xs text-muted-foreground">Session ID</span>
            <span className="text-xs font-mono text-primary break-all text-right">
              {sessionId ? sessionId.slice(0, 8) + "..." : "pending..."}
            </span>
          </div>
        </div>

        {/* Tools list removed: replaced by View Tools button + modal */}
      </aside>

      {/* Right side: main chat area */}
      <section className="relative z-10 flex min-h-0 flex-1 flex-col items-center px-4 py-2 md:px-8 md:py-3">
        <div className="flex h-full w-full max-w-8xl flex-1 flex-col gap-3 rounded-lg border bg-card px-3 pb-3 pt-2 sm:gap-4 sm:px-8 sm:pb-6 sm:pt-4 md:px-10 md:pt-5">
          {/* Top bar */}
          <div className="flex flex-col gap-2 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 border-2 border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary rounded-full shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-slow" />
                <span className="font-medium">Active Session</span>
                </div>
              <h1 className="text-xl font-bold sm:text-2xl flex items-center gap-2">
                <span className="text-primary">Ready</span>
                <span className="text-foreground"> for Input</span>
                <Heart className="h-5 w-5 text-primary/60 animate-pulse-slow hidden sm:inline-block" />
              </h1>
            </div>

            {/* Controls - mobile layout */}
            <div className="flex w-full items-center gap-1 overflow-x-auto pb-1 md:hidden">
              <div
                className={`flex items-center rounded-full border px-2 py-1 text-[10px] ${
                  tokenUsage === null
                    ? "border-border bg-muted text-muted-foreground"
                    : isTokenCritical
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : isTokenWarning
                    ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                    : "border-primary/60 bg-primary/10 text-primary"
                }`}
              >
                {tokenUsage === null
                  ? "Tokens"
                  : tokenUsage.toLocaleString()}
              </div>

              {isTokenWarning && (
                <div
                  className={`flex items-center gap-1 text-[10px] ${
                    isTokenCritical
                      ? "text-destructive"
                      : "text-yellow-600 dark:text-yellow-400"
                  }`}
                >
                  <AlertTriangle className="h-3 w-3" />
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleManualCompress}
                disabled={!sessionId || isCompressing}
                className="h-8 w-8 flex-shrink-0 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                {isCompressing ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <span className="text-[10px] text-primary">C</span>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setIsToolsModalOpen(true)}
                disabled={toolsError !== null}
                className="h-8 w-8 flex-shrink-0 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                <Wrench className="h-3 w-3 text-primary" />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleOpenFilesModal}
                className="h-8 w-8 flex-shrink-0 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                <FolderOpen className="h-3 w-3 text-primary" />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handlePing}
                disabled={pingLoading}
                className="h-8 w-8 flex-shrink-0 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                {pingLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <span className="text-[10px] text-primary">ping</span>
                )}
              </Button>

              {pingResponse && (
                <span className="ml-1 flex-shrink-0 text-[10px] font-mono text-muted-foreground">
                  {pingResponse}
                </span>
              )}
            </div>

            {/* Controls - desktop / tablet layout */}
            <div className="hidden flex-wrap items-center gap-2 md:flex">
              {messages.length === 0 && (
                <>
                  <button
                    type="button"
                    className="border-2 border-primary/30 bg-card px-2 py-1 rounded-lg text-xs transition-all duration-200 hover:bg-primary/10 hover:border-primary/50 hover:shadow-sm font-medium"
                    onClick={() =>
                      setInput("Help me track the latest releases and funding rounds of several AI companies.")
                    }
                  >
                    Describe monitoring scenario
                  </button>
                  <button
                    type="button"
                    className="border-2 border-primary/30 bg-card px-2 py-1 rounded-lg text-xs transition-all duration-200 hover:bg-primary/10 hover:border-primary/50 hover:shadow-sm font-medium"
                    onClick={() =>
                      setInput("Check this requirements document for ambiguities and summarize the risks.")
                    }
                  >
                    Provide context
                  </button>
                </>
              )}

              <div
                className={`rounded-full border px-2 py-1 text-xs ${
                  tokenUsage === null
                    ? "border-border bg-muted text-muted-foreground"
                    : isTokenCritical
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : isTokenWarning
                    ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                    : "border-primary/60 bg-primary/10 text-primary"
                }`}
              >
                {tokenUsage === null
                  ? "Tokens: pending"
                  : `Tokens: ${tokenUsage.toLocaleString()}`}
              </div>
              
              {isTokenWarning && (
                <div className={`flex items-center gap-1 text-xs ${
                  isTokenCritical ? "text-destructive" : "text-yellow-600 dark:text-yellow-400"
                }`}>
                  <AlertTriangle className="h-3 w-3" />
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualCompress}
                disabled={!sessionId || isCompressing}
                className="text-xs h-7 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                {isCompressing ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <span className="text-primary">Compress</span>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsToolsModalOpen(true)}
                disabled={toolsError !== null}
                className="text-xs h-7 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                <Wrench className="h-3 w-3 text-primary" />
                <span className="text-primary">
                  {toolsError ? "Tools Unavailable" : `Tools ${totalTools || 0}`}
                </span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenFilesModal}
                className="text-xs h-7 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                <FolderOpen className="h-3 w-3 text-primary" />
                <span className="text-primary">Files</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePing}
                disabled={pingLoading}
                className="text-xs h-7 border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
              >
                {pingLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <span className="text-primary">ping</span>
                )}
              </Button>
              {pingResponse && (
                <span className="text-xs font-mono text-muted-foreground">
                  {pingResponse}
                </span>
              )}
            </div>
          </div>

          {/* Messages area */}
          <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto pr-1 sm:space-y-4 sm:pr-2">
            {messages.length === 0 && (
              <div className="py-12 text-center animate-fade-in">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4 relative">
                  <Heart className="h-10 w-10 text-primary animate-heartbeat" />
                  <Sparkles className="h-5 w-5 text-primary/60 absolute -top-1 -right-1 animate-pulse-slow" />
                </div>
                <div className="text-sm font-medium text-primary mb-2">System Ready</div>
                <div className="text-xs text-muted-foreground max-w-md mx-auto">
                  Type your question below or use a sample prompt to start. I'm here to help! 💕
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex items-start gap-3 animate-message-in ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 w-24 h-24">
                    <div className="relative w-full h-full rounded-full border-[3px] border-primary/40 shadow-md overflow-hidden bg-white ring-2 ring-primary/10">
                      <Image
                        src={assistantAvatarSrc}
                        alt={assistantName}
                        fill
                        sizes="90px"
                        className="object-cover"
                        priority
                      />
                    </div>
                  </div>
                )}
                <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed border-l-4 border-primary/30 bg-card shadow-sm hover:shadow-md transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary/60 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="mb-1.5 text-xs font-medium text-primary/80 flex items-center gap-1.5">
                    {message.role === "assistant" && (
                      <Heart className="h-3 w-3 text-primary/60 animate-pulse-slow" />
                    )}
                    {message.role === "user" ? "User" : assistantName}
                  </div>
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <ToolCallsDisplay
                      toolCalls={message.toolCalls}
                      isFullPage={true}
                    />
                  )}
                  <div className="text-sm leading-relaxed">
                    {renderMessageContent(message.content)}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start items-start gap-3 animate-fade-in">
                <div className="flex-shrink-0 w-24 h-24">
                  <div className="relative w-full h-full rounded-full border-[3px] border-primary/40 shadow-md overflow-hidden bg-white ring-2 ring-primary/10 animate-fade-in">
                    <Image
                      src={assistantAvatarSrc}
                      alt={assistantName}
                      fill
                      sizes="96px"
                      className="object-cover"
                      priority
                    />
                  </div>
                </div>
                <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed border-l-4 border-primary/30 bg-card shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary/60 to-primary/20 animate-pulse-slow" />
                  <div className="mb-1.5 text-xs font-medium text-primary/80 flex items-center gap-1.5">
                    <Heart className="h-3 w-3 text-primary/60 animate-pulse-slow" />
                    {assistantName}
                  </div>
                  <div className="text-sm leading-relaxed flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-muted-foreground">Processing...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <div className="text-xs font-semibold mb-1">Error</div>
              <div>{error}</div>
            </div>
          )}

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg border-2 border-primary/40 bg-card px-3 py-1.5 shadow-sm hover:shadow-md transition-shadow"
                  >
                  {attachment.isTextFile ? (
                    <FileText className="h-3 w-3 text-primary" />
                  ) : (
                  <File className="h-3 w-3 text-primary" />
                  )}
                  <span className="text-xs text-foreground">
                    {attachment.filename}
                    {attachment.isTextFile && (
                      <span className="ml-1 text-muted-foreground">(read)</span>
                    )}
                  </span>
                  <button
                    onClick={() => handleRemoveAttachment(index)}
                    className="text-primary hover:text-primary/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="mt-2 flex items-center gap-3 rounded-xl border-2 border-primary/20 bg-card px-4 py-3 shadow-sm hover:border-primary/40 transition-all duration-200 focus-within:border-primary/60 focus-within:shadow-md">
            {messages.length === 0 && (
              <div className="hidden flex-wrap gap-2 text-xs text-muted-foreground md:flex">
                <button
                  type="button"
                  className="border-2 border-primary/30 bg-card px-3 py-1.5 rounded-lg transition-all duration-200 hover:bg-primary/10 hover:border-primary/50 hover:shadow-sm text-xs font-medium"
                  onClick={() =>
                    setInput("Help me track the latest releases and funding rounds of several AI companies.")
                  }
                >
                  Monitor AI companies
                </button>
                <button
                  type="button"
                  className="border-2 border-primary/30 bg-card px-3 py-1.5 rounded-lg transition-all duration-200 hover:bg-primary/10 hover:border-primary/50 hover:shadow-sm text-xs font-medium"
                  onClick={() =>
                    setInput("Check this requirements document for ambiguities and summarize the risks.")
                  }
                >
                  Analyze requirements context
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept="*/*"
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              size="icon"
              variant="ghost"
              disabled={isLoading}
              className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-all duration-200"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Send a message or describe the scenario you want to monitor..."
              disabled={isLoading}
              className="flex-1 border-0 focus-visible:ring-2 focus-visible:ring-primary/30 bg-transparent"
            />
            <Button
              onClick={handleSend}
              disabled={(!input.trim() && attachments.length === 0) || isLoading}
              size="icon"
              className="h-10 w-10 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 disabled:hover:scale-100"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Files modal */}
        {isFilesModalOpen && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-md">
            <div className="relative max-h-[82vh] w-full max-w-4xl overflow-hidden rounded-2xl border bg-card shadow-lg">
              <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4 sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    <span className="text-lg font-semibold">
                      Acontext Disk Files
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Files stored in Acontext Disk
                  </div>
                </div>

                <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLoadFiles}
                    disabled={isFilesLoading}
                    className="text-xs"
                  >
                    {isFilesLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span>Refresh</span>
                    )}
                  </Button>
                  <div className="rounded-lg border bg-muted px-3 py-1.5 text-xs">
                    {files.length} files
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setIsFilesModalOpen(false)}
                    className="h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="max-h-[70vh] space-y-3 overflow-y-auto px-6 py-4">
                {filesError && (
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3.5 py-2.5">
                    <div className="text-sm text-destructive">
                      Failed to load files: {filesError}
                    </div>
                  </div>
                )}

                {isFilesLoading && files.length === 0 && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-3 text-sm text-muted-foreground">
                      Loading files...
                    </span>
                  </div>
                )}

                {!isFilesLoading && !filesError && files.length === 0 && (
                  <div className="py-12 text-center">
                    <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" />
                    <div className="text-sm text-muted-foreground">
                      No files found in Acontext Disk
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      Upload files using the attachment button to see them here
                    </div>
                  </div>
                )}

                {files.map((file, index) => {
                  const fileKey = file.id || file.path || file.filename || String(index);
                  const preview = filePreviews.get(fileKey);
                  const mimeType = file.mimeType || "";
                  const { isImage, isText } = detectFileType(file.filename, mimeType);
                  const isPreviewable = isImage || isText;
                  
                  // Determine preview display type based on preview's MIME type or file type
                  const previewMimeType = preview?.mimeType || mimeType;
                  const previewIsImage = previewMimeType.startsWith("image/") || 
                                        (preview && detectFileType(file.filename, previewMimeType).isImage);
                  const previewIsText = previewMimeType.startsWith("text/") || 
                                       previewMimeType === "application/json" ||
                                       previewMimeType === "application/javascript" ||
                                       previewMimeType === "application/xml" ||
                                       previewMimeType === "application/x-sh" ||
                                       previewMimeType === "application/x-yaml" ||
                                       previewMimeType === "application/yaml" ||
                                       (preview && detectFileType(file.filename, previewMimeType).isText);

                  return (
                    <div
                      key={fileKey}
                    className="rounded-xl border bg-card p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <File className="h-4 w-4 text-primary flex-shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {file.filename || file.path || "Unknown file"}
                        </span>
                      </div>
                        {(preview?.publicUrl || filePublicUrls.get(fileKey)) && (
                          <a
                            href={preview?.publicUrl || filePublicUrls.get(fileKey)}
                            download={file.filename || file.path || "download"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center rounded-md border bg-background px-2 py-1 text-xs font-medium text-primary shadow-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            Download
                          </a>
                        )}
                    </div>

                      {/* Preview Section */}
                      {preview && (
                        <div className="mt-3 border-t pt-3">
                          {preview.isLoading && (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              <span className="ml-2 text-xs text-muted-foreground">
                                Loading preview...
                              </span>
                            </div>
                          )}
                          {preview.error && (
                            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2">
                              <div className="text-xs text-destructive">
                                Preview error: {preview.error}
                              </div>
                            </div>
                          )}
                          {!preview.isLoading && !preview.error && preview.content && (
                            <>
                              {previewIsImage && (() => {
                                // If content is a URL (publicUrl), use it directly
                                if (preview.isUrl) {
                                  return (
                                    <div className="rounded-lg border bg-muted overflow-hidden">
                                      <img
                                        src={preview.content}
                                        alt={file.filename || "Preview"}
                                        className="w-full h-auto max-h-64 object-contain"
                                        onError={(e) => {
                                          console.error("[UI] Failed to load image preview from URL", {
                                            fileKey,
                                            filename: file.filename,
                                            url: preview.content,
                                            mimeType: previewMimeType,
                                          });
                                          e.currentTarget.style.display = "none";
                                        }}
                                        onLoad={() => {
                                          console.debug("[UI] Image preview loaded successfully from URL", {
                                            fileKey,
                                            filename: file.filename,
                                            mimeType: previewMimeType,
                                          });
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                
                                // Otherwise, treat as base64 content
                                // Clean base64 string: remove whitespace and ensure it's valid
                                let base64Content = preview.content;
                                if (typeof base64Content === 'string') {
                                  // Remove any whitespace characters (spaces, newlines, etc.)
                                  base64Content = base64Content.replace(/\s/g, '');
                                }
                                
                                // Validate base64 format
                                const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                                const isValidBase64 = base64Regex.test(base64Content);
                                
                                if (!isValidBase64) {
                                  console.error("[UI] Invalid base64 content for image preview", {
                                    fileKey,
                                    filename: file.filename,
                                    mimeType: previewMimeType,
                                    contentLength: base64Content.length,
                                    contentPreview: base64Content.substring(0, 50),
                                  });
                                }
                                
                                const dataUrl = `data:${previewMimeType};base64,${base64Content}`;
                                
                                return (
                                  <div className="rounded-lg border bg-muted overflow-hidden">
                                    <img
                                      src={dataUrl}
                                      alt={file.filename || "Preview"}
                                      className="w-full h-auto max-h-64 object-contain"
                                      onError={(e) => {
                                        console.error("[UI] Failed to load image preview", {
                                          fileKey,
                                          filename: file.filename,
                                          mimeType: previewMimeType,
                                          contentLength: base64Content.length,
                                          isValidBase64,
                                          dataUrlPreview: dataUrl.substring(0, 100),
                                        });
                                        e.currentTarget.style.display = "none";
                                      }}
                                      onLoad={() => {
                                        console.debug("[UI] Image preview loaded successfully", {
                                          fileKey,
                                          filename: file.filename,
                                          mimeType: previewMimeType,
                                        });
                                      }}
                                    />
                                  </div>
                                );
                              })()}
                              {previewIsText && !previewIsImage && (
                                <div className="rounded-lg border bg-muted p-3 max-h-64 overflow-auto">
                                  <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                                    {preview.content.length > 2000
                                      ? preview.content.substring(0, 2000) + "\n\n... (truncated)"
                                      : preview.content}
                                  </pre>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {file.mimeType && (
                        <div>
                          <span className="text-xs text-muted-foreground">
                            Type
                          </span>
                          <div className="text-sm mt-1 font-mono">
                            {file.mimeType}
                          </div>
                        </div>
                      )}
                      {file.size !== undefined && (
                        <div>
                          <span className="text-xs text-muted-foreground">
                            Size
                          </span>
                          <div className="text-sm mt-1 font-mono">
                            {file.size > 1024 * 1024
                              ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                              : file.size > 1024
                              ? `${(file.size / 1024).toFixed(2)} KB`
                              : `${file.size} bytes`}
                          </div>
                        </div>
                      )}
                      {file.createdAt && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted-foreground">
                            Created
                          </span>
                          <div className="text-sm mt-1">
                            {new Date(file.createdAt).toLocaleString()}
                          </div>
                        </div>
                      )}
                      {file.path && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted-foreground">
                            Path
                          </span>
                          <div className="text-xs font-mono mt-1 break-all">
                            {file.path}
                          </div>
                        </div>
                      )}
                        {(preview?.publicUrl || filePublicUrls.get(fileKey)) && (
                          <div className="col-span-2">
                            <span className="text-xs text-muted-foreground">
                              Public URL
                            </span>
                            <div className="mt-1">
                              <a
                                href={preview?.publicUrl || filePublicUrls.get(fileKey)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 break-all"
                              >
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{preview?.publicUrl || filePublicUrls.get(fileKey)}</span>
                              </a>
                    </div>
                  </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tools modal */}
        {isToolsModalOpen && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-md">
            <div className="relative max-h-[82vh] w-full max-w-4xl overflow-hidden rounded-2xl border bg-card shadow-lg">
              <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4 sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-primary" />
                    <span className="text-lg font-semibold">
                      Available Tools
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Tools that the model can call in this session
                  </div>
                </div>

                <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
                  <div className="rounded-lg border bg-muted px-3 py-1.5 text-xs">
                    Registered {totalTools || 0}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setIsToolsModalOpen(false)}
                    className="h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="max-h-[70vh] space-y-3 overflow-y-auto px-6 py-4">
                {toolsError && (
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3.5 py-2.5">
                    <div className="text-sm text-destructive">
                      Failed to load tools: {toolsError}
                    </div>
                  </div>
                )}

                {!toolsError && availableTools.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No tools are registered.
                  </div>
                )}

                {availableTools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-xl border bg-card p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        <span className="text-sm font-semibold">
                          {tool.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs">
                          Registered
                        </span>
                      </div>
                    </div>

                    <div className="text-sm leading-relaxed">
                      {tool.description || "No description"}
                    </div>

                    {tool.parameters.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <div className="text-xs text-muted-foreground">
                          Parameters ({tool.parameters.length})
                        </div>
                        {tool.parameters.map((param) => (
                          <div
                            key={`${tool.name}-${param.name}`}
                            className="rounded-lg border bg-muted/50 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {param.name}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {param.type}
                                {param.required ? " • required" : ""}
                              </span>
                            </div>
                            {param.description && (
                              <div className="mt-1 text-sm leading-relaxed">
                                {param.description}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Right side: Images sidebar */}
      <aside className="relative hidden h-full w-64 flex-col border-l bg-card px-4 py-3 lg:flex">
        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="sticky top-0 bg-card pb-2 z-10">
            <div className="flex items-center gap-2 mb-1">
              <FolderOpen className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Images</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {files.filter(f => {
                const { isImage } = detectFileType(f.filename, f.mimeType);
                return isImage;
              }).length} image{files.filter(f => {
                const { isImage } = detectFileType(f.filename, f.mimeType);
                return isImage;
              }).length !== 1 ? 's' : ''}
            </div>
          </div>

          {isFilesLoading && files.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="ml-2 text-xs text-muted-foreground">
                Loading images...
              </span>
            </div>
          )}

          {filesError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2">
              <div className="text-xs text-destructive">
                Failed to load: {filesError}
              </div>
            </div>
          )}

          {!isFilesLoading && !filesError && files.filter(f => {
            const { isImage } = detectFileType(f.filename, f.mimeType);
            return isImage;
          }).length === 0 && (
            <div className="py-8 text-center">
              <File className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
              <div className="text-xs text-muted-foreground">
                No images found
              </div>
            </div>
          )}

          {files
            .filter(file => {
              const { isImage } = detectFileType(file.filename, file.mimeType);
              return isImage;
            })
            .map((file, index) => {
              const fileKey = file.id || file.path || file.filename || String(index);
              const preview = filePreviews.get(fileKey);
              const mimeType = file.mimeType || "";
              const { isImage } = detectFileType(file.filename, mimeType);
              
              if (!isImage) return null;

              const previewMimeType = preview?.mimeType || mimeType;
              const previewIsImage = previewMimeType.startsWith("image/") || 
                                    (preview && detectFileType(file.filename, previewMimeType).isImage);

              return (
                <div
                  key={fileKey}
                  className="rounded-lg border bg-card p-2 space-y-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <File className="h-3 w-3 text-primary flex-shrink-0" />
                    <span className="text-xs font-medium truncate" title={file.filename || file.path || "Unknown file"}>
                      {file.filename || file.path || "Unknown file"}
                    </span>
                  </div>

                  {/* Image Preview */}
                  {preview && (
                    <div className="mt-2">
                      {preview.isLoading && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        </div>
                      )}
                      {preview.error && (
                        <div className="rounded border border-destructive/50 bg-destructive/10 px-2 py-1">
                          <div className="text-xs text-destructive">
                            Error loading preview
                          </div>
                        </div>
                      )}
                      {!preview.isLoading && !preview.error && preview.content && previewIsImage && (
                        <>
                          {preview.isUrl ? (
                            <div className="rounded border bg-muted overflow-hidden">
                              <img
                                src={preview.content}
                                alt={file.filename || "Preview"}
                                className="w-full h-auto max-h-48 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(preview.content, '_blank')}
                                onError={(e) => {
                                  console.error("[UI] Failed to load image preview from URL", {
                                    fileKey,
                                    filename: file.filename,
                                    url: preview.content,
                                  });
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </div>
                          ) : (
                            <div className="rounded border bg-muted overflow-hidden">
                              <img
                                src={`data:${previewMimeType};base64,${preview.content.replace(/\s/g, '')}`}
                                alt={file.filename || "Preview"}
                                className="w-full h-auto max-h-48 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => {
                                  const dataUrl = `data:${previewMimeType};base64,${preview.content.replace(/\s/g, '')}`;
                                  window.open(dataUrl, '_blank');
                                }}
                                onError={(e) => {
                                  console.error("[UI] Failed to load image preview", {
                                    fileKey,
                                    filename: file.filename,
                                  });
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Download button */}
                  {(preview?.publicUrl || filePublicUrls.get(fileKey)) && (
                    <a
                      href={preview?.publicUrl || filePublicUrls.get(fileKey)}
                      download={file.filename || file.path || "download"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full rounded-md border bg-background px-2 py-1 text-xs font-medium text-primary shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Download
                    </a>
                  )}
                </div>
              );
            })}
        </div>
      </aside>
    </div>
  );
}
