/**
 * Acontext integration utilities
 * 
 * Provides:
 * - Semantic search across conversation history
 * - File upload and artifact management
 * - Session management with Acontext
 * - Context editing with automatic token management
 */

import OpenAI from "openai";
import { getAcontextClient } from "@/lib/acontext-client";
import type { ChatSession } from "@/types/chat";

/**
 * Edit strategy types for context editing
 * These match the Acontext SDK's expected format
 */
export type EditStrategy =
  | {
      type: "token_limit";
      params: {
        limit_tokens: number;
      };
    }
  | {
      type: "remove_tool_result";
      params: {
        keep_recent_n_tool_results?: number;
        tool_result_placeholder?: string;
      };
    }
  | {
      type: "remove_tool_call_params";
      params: {
        keep_recent_n_tool_calls?: number;
      };
    };

/**
 * Token count information from Acontext
 */
export interface TokenCounts {
  total_tokens: number;
}

/**
 * Enhanced error logging helper with deep error extraction
 */
async function logAcontextError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const errorDetails: Record<string, unknown> = {
    operation,
    timestamp: new Date().toISOString(),
    ...context,
  };

  // Recursively extract error information including cause chain
  function extractErrorInfo(err: unknown, depth = 0): Record<string, unknown> {
    if (depth > 5) return { message: "Error chain too deep" }; // Prevent infinite recursion
    
    const info: Record<string, unknown> = {};
    
    if (err instanceof Error) {
      info.message = err.message;
      info.name = err.name;
      info.stack = err.stack;
      
      // Extract cause recursively
      if (err.cause) {
        info.cause = extractErrorInfo(err.cause, depth + 1);
      }
      
      // Check for Node.js system errors (which have code, errno, syscall, etc.)
      if ('code' in err) {
        info.code = (err as any).code;
      }
      if ('errno' in err) {
        info.errno = (err as any).errno;
      }
      if ('syscall' in err) {
        info.syscall = (err as any).syscall;
      }
      if ('hostname' in err) {
        info.hostname = (err as any).hostname;
      }
      if ('port' in err) {
        info.port = (err as any).port;
      }
      
      // Network error detection
      const errorMsg = err.message.toLowerCase();
      if (
        errorMsg.includes("fetch failed") ||
        errorMsg.includes("econnrefused") ||
        errorMsg.includes("enotfound") ||
        errorMsg.includes("etimedout") ||
        errorMsg.includes("econnreset") ||
        errorMsg.includes("certificate") ||
        errorMsg.includes("ssl") ||
        errorMsg.includes("tls")
      ) {
        errorDetails.type = "network_error";
        
        // Provide specific diagnosis
        if (errorMsg.includes("enotfound")) {
          errorDetails.diagnosis = "DNS resolution failed - cannot resolve hostname";
        } else if (errorMsg.includes("econnrefused")) {
          errorDetails.diagnosis = "Connection refused - server may be down or firewall blocking";
        } else if (errorMsg.includes("etimedout")) {
          errorDetails.diagnosis = "Connection timeout - network may be slow or unreachable";
        } else if (errorMsg.includes("certificate") || errorMsg.includes("ssl") || errorMsg.includes("tls")) {
          errorDetails.diagnosis = "SSL/TLS certificate error - check certificate validity";
        } else {
          errorDetails.diagnosis = "Network request failed - check connectivity, firewall, and proxy settings";
        }
      }
    } else if (err && typeof err === 'object') {
      // Try to extract properties from error-like objects
      try {
        info.rawError = JSON.stringify(err);
      } catch {
        info.rawError = String(err);
      }
    } else {
      info.error = String(err);
    }
    
    return info;
  }

  const errorInfo = extractErrorInfo(error);
  Object.assign(errorDetails, errorInfo);

  // Configuration check
  const apiKey = process.env.ACONTEXT_API_KEY;
  const baseUrl = process.env.ACONTEXT_BASE_URL ?? "https://api.acontext.com/api/v1";
  errorDetails.config = {
    apiKeyPresent: !!apiKey,
    apiKeyLength: apiKey?.length ?? 0,
    baseUrl,
    nodeVersion: process.version,
    platform: process.platform,
  };

  // URL validation
  try {
    const url = new URL(baseUrl);
    errorDetails.urlValidation = {
      valid: true,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
    };
  } catch (urlError) {
    errorDetails.urlValidation = {
      valid: false,
      error: urlError instanceof Error ? urlError.message : String(urlError),
    };
  }

  // Network environment info
  errorDetails.networkEnv = {
    httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy || undefined,
    httpProxy: process.env.HTTP_PROXY || process.env.http_proxy || undefined,
    noProxy: process.env.NO_PROXY || process.env.no_proxy || undefined,
  };

  // If it's a network error, try to test connectivity using SDK (but don't block on it)
  if (errorDetails.type === "network_error") {
    try {
      const client = getAcontextClient();
      if (client) {
        // Test connection by calling a simple SDK method with timeout
        try {
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Connection test timeout")), 5000)
          );
          
          // Test connection using ping() method (as shown in official examples)
          await Promise.race([
            client.ping(),
            timeoutPromise
          ]);
          
          errorDetails.connectionTest = {
            success: true,
            method: "SDK: ping()",
            timestamp: new Date().toISOString(),
          };
        } catch (testError) {
          errorDetails.connectionTest = {
            success: false,
            method: "SDK: ping()",
            error: testError instanceof Error ? testError.message : String(testError),
            timestamp: new Date().toISOString(),
          };
        }
      } else {
        errorDetails.connectionTest = {
          error: "Acontext client not available (missing API key)",
        };
      }
    } catch (testError) {
      errorDetails.connectionTest = {
        error: testError instanceof Error ? testError.message : String(testError),
      };
    }
  }

  console.error(`[Acontext] ${operation}:`, JSON.stringify(errorDetails, null, 2));
}

/**
 * Get or create the default Acontext Space for a user.
 *
 * Strategy:
 * - One long-lived Space per user (stored in user_acontext_spaces table)
 * - All new chat sessions created for this user attach to this Space
 *
 * If Acontext is not configured, returns null and callers should gracefully skip
 * Space attachment (sessions will still work, just without self-learned skills).
 */
export async function getOrCreateUserSpaceId(
  userId: string
): Promise<string | null> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return null;
  }

  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    // 1) Try to load existing mapping
    const { data, error } = await supabase
      .from("user_acontext_spaces")
      .select("space_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.warn(
        "[Acontext] Failed to load user_acontext_spaces mapping; falling back to session without Space:",
        error.message
      );
      return null;
    }

    if (data?.space_id) {
      return data.space_id as string;
    }

    // 2) Create a new Space for this user
    console.debug("[Acontext] Creating default Space for user", {
      userId,
    });

    const space = await acontext.spaces.create({
      // Optional metadata to aid debugging/inspection
      name: `user-${userId}`,
      description:
        "Default personal Space for self-learned skills and SOPs for this user.",
    } as any);

    const spaceId = (space as any).id as string | undefined;
    if (!spaceId) {
      console.warn(
        "[Acontext] Created Space but response did not include id; skipping mapping"
      );
      return null;
    }

    // 3) Persist mapping (best-effort, non-fatal)
    try {
      const { error: insertError } = await supabase
        .from("user_acontext_spaces")
        .insert({
          user_id: userId,
          space_id: spaceId,
        });

      if (insertError) {
        console.warn(
          "[Acontext] Failed to persist user_acontext_spaces mapping; skills will still learn, but mapping is not cached:",
          insertError.message
        );
      }
    } catch (persistError) {
      console.warn(
        "[Acontext] Unexpected error while persisting user_acontext_spaces mapping:",
        persistError
      );
    }

    return spaceId;
  } catch (error) {
    await logAcontextError(
      "Failed to get or create default user Space",
      error,
      {
        userId,
      }
    );
    return null;
  }
}

/**
 * Get or create an Acontext session for a chat session
 * Returns the Acontext session ID, or null if Acontext is not configured
 *
 * NOTE: This is mostly kept for backwards compatibility; new sessions are created
 * through createAcontextSessionDirectly, which already handles user Space binding.
 */
export async function getOrCreateAcontextSession(
  chatSession: ChatSession,
  userId: string
): Promise<string | null> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return null;
  }

  // If we already have an Acontext session ID, return it
  if (chatSession.acontextSessionId) {
    return chatSession.acontextSessionId;
  }

  // Create a new Acontext session (legacy path, without explicit Space binding)
  try {
    const configs = {
      userId,
      chatSessionId: chatSession.id,
      source: "nextjs-with-supabase-chatbot",
    };
    
    console.debug("[Acontext] Creating session", {
      chatSessionId: chatSession.id,
      userId,
      configs,
    });

    const acontextSession = await acontext.sessions.create({
      configs,
    });

    console.debug("[Acontext] Session created successfully", {
      acontextSessionId: acontextSession.id,
    });

    // Update the chat session with the Acontext session ID
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    await supabase
      .from("chat_sessions")
      .update({ acontext_session_id: acontextSession.id })
      .eq("id", chatSession.id);

    return acontextSession.id;
  } catch (error) {
    await logAcontextError("Failed to create Acontext session", error, {
      chatSessionId: chatSession.id,
      userId,
    });
    return null;
  }
}

/**
 * Search for relevant messages in Acontext using semantic search
 * Returns relevant context messages that can be injected into the conversation
 */
export async function searchRelevantContext(
  query: string,
  acontextSessionId?: string,
  limit: number = 5
): Promise<Array<{ role: string; content: string; score?: number }>> {
  const acontext = getAcontextClient();
  if (!acontext || !acontextSessionId) {
    return [];
  }

  try {
    // Get messages from the Acontext session
    // Note: Acontext's semantic search is typically done via the sessions API
    // We'll retrieve recent messages and use them as context
    // For true semantic search, you may need to use Acontext's search API if available
    
    console.debug("[Acontext] Searching relevant context", {
      acontextSessionId,
      query,
      limit,
    });
    
    const messages = await acontext.sessions.getMessages(acontextSessionId, {
      format: "openai",
      limit: limit * 2, // Get more messages to filter
    });

    if (!messages || !messages.items || messages.items.length === 0) {
      console.debug("[Acontext] No messages found in session");
      return [];
    }

    // For now, return recent messages as context
    // In a production system, you'd want to use Acontext's semantic search API
    // to find the most relevant messages based on the query
    const relevantMessages = messages.items
      .slice(-limit)
      .map((msg: any) => ({
        role: msg.role || "user",
        content: typeof msg.content === "string" ? msg.content : String(msg.content),
      }));

    console.debug("[Acontext] Found relevant messages", {
      count: relevantMessages.length,
    });

    return relevantMessages;
  } catch (error) {
    await logAcontextError("Failed to search relevant context", error, {
      acontextSessionId,
      query,
      limit,
    });
    return [];
  }
}

/**
 * Search for relevant skills (SOP blocks) in Acontext Space based on user query
 * Returns relevant skills that can be used during conversation
 */
export async function searchRelevantSkills(
  query: string,
  spaceId: string
): Promise<Array<{
  title: string;
  summary: string;
  content?: string;
  use_when?: string;
  preferences?: string;
}>> {
  const client = getAcontextClient();
  if (!client || !spaceId) {
    return [];
  }

  try {
    console.debug("[Acontext] Searching relevant skills", {
      spaceId,
      query,
    });

    // Use experienceSearch to find relevant SOP blocks
    const searchResult = (await client.spaces.experienceSearch(spaceId, {
      query,
      mode: "fast",
      // No limit - return all relevant skills
    } as any)) as any;

    const blocks = (searchResult?.cited_blocks ?? []) as Array<any>;

    if (!blocks || blocks.length === 0) {
      console.debug("[Acontext] No relevant skills found");
      return [];
    }

    // Map blocks to skills format
    const skills = blocks.map((block: any) => {
      const title: string =
        block.title ||
        block.name ||
        block.props?.title ||
        block.properties?.title ||
        block.metadata?.title ||
        "Untitled skill";

      let summary: string =
        block.summary ||
        block.description ||
        block.props?.summary ||
        block.props?.description ||
        block.properties?.summary ||
        block.properties?.description ||
        block.metadata?.summary ||
        block.metadata?.description ||
        "";

      // If no summary found, try to construct one from SOP-specific fields
      if (!summary) {
        const parts: string[] = [];

        const useWhen =
          block.props?.use_when ||
          block.properties?.use_when ||
          block.use_when;
        if (useWhen) {
          parts.push(`Use when: ${useWhen}`);
        }

        const preferences =
          block.props?.preferences ||
          block.properties?.preferences ||
          block.preferences;
        if (preferences) {
          parts.push(`Preferences: ${preferences}`);
        }

        summary = parts.length > 0 ? parts.join(". ") : "No summary available.";
      }

      const content =
        block.content ||
        block.text ||
        block.props?.content ||
        block.properties?.content;

      return {
        title,
        summary,
        content: typeof content === "string" ? content : undefined,
        use_when:
          block.props?.use_when ||
          block.properties?.use_when ||
          block.use_when,
        preferences:
          block.props?.preferences ||
          block.properties?.preferences ||
          block.preferences,
      };
    });

    console.debug("[Acontext] Found relevant skills", {
      count: skills.length,
    });

    return skills;
  } catch (error) {
    await logAcontextError("Failed to search relevant skills", error, {
      spaceId,
      query,
    });
    return [];
  }
}

/**
 * Upload a file to Acontext as an artifact
 * Returns the artifact path or null if upload fails
 */
export async function uploadFileToAcontext(
  filename: string,
  content: Buffer | string,
  mimeType: string,
  diskId?: string
): Promise<string | null> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return null;
  }

  try {
    // If no diskId provided, list disks and use the first one, or create one
    let targetDiskId = diskId;
    if (!targetDiskId) {
      const disks = await acontext.disks.list();
      if (disks && disks.items && disks.items.length > 0) {
        targetDiskId = disks.items[0].id;
      } else {
        // Create a default disk
        const newDisk = await acontext.disks.create();
        targetDiskId = newDisk.id;
      }
    }

    // Convert content to Buffer if it's a string (base64)
    let fileBuffer: Buffer;
    if (typeof content === "string") {
      // Assume it's base64 encoded
      fileBuffer = Buffer.from(content, "base64");
    } else {
      fileBuffer = content;
    }

    // Parse filename to separate directory path and filename
    // filename format: "generated/2026-01-15/image.png" or "image.png"
    const pathParts = filename.split('/').filter(part => part.length > 0);
    const filenameOnly = pathParts.length > 0 ? pathParts[pathParts.length - 1] : filename;
    const filePathDir = pathParts.length > 1 
      ? '/' + pathParts.slice(0, -1).join('/') + '/'
      : '/';

    // Upload the artifact
    // The API expects filePath (directory) and file (filename only) to be separate
    console.debug("[Acontext] Uploading artifact", {
      diskId: targetDiskId,
      filename: filenameOnly,
      filePath: filePathDir,
      mimeType,
      size: fileBuffer.length,
    });

    const artifact = await acontext.disks.artifacts.upsert(targetDiskId, {
      file: [filenameOnly, fileBuffer, mimeType],
      filePath: filePathDir,
    });

    console.debug("[Acontext] Artifact uploaded successfully", {
      artifact,
    });

    // Build full path from artifact response
    // artifact.path is the directory (e.g., "/generated/2026-01-15/")
    // artifact.filename is the filename (e.g., "image_xxx.png")
    const artifactPath = (artifact as any).path as string | undefined;
    const artifactFilename = (artifact as any).filename as string | undefined;
    
    if (artifactPath && artifactFilename) {
      // Combine path and filename, ensuring path ends with / and removing duplicate slashes
      const normalizedPath = artifactPath.endsWith('/') ? artifactPath : artifactPath + '/';
      const fullPath = normalizedPath + artifactFilename;
      // Remove leading slash if present to match expected format
      return fullPath.startsWith('/') ? fullPath.substring(1) : fullPath;
    }

    // Fallback to the original filename if artifact info is not available
    return filename;
  } catch (error) {
    await logAcontextError("Failed to upload file", error, {
      filename,
      mimeType,
      diskId,
      contentSize: typeof content === "string" ? content.length : content.length,
    });
    return null;
  }
}

/**
 * Recursively list all artifacts from a directory path
 * Helper function for listAcontextArtifacts
 */
async function listArtifactsRecursive(
  acontext: ReturnType<typeof getAcontextClient>,
  diskId: string,
  path: string,
  allArtifacts: Array<{ id?: string; path?: string; filename?: string; mimeType?: string; size?: number; createdAt?: string }> = []
): Promise<Array<{ id?: string; path?: string; filename?: string; mimeType?: string; size?: number; createdAt?: string }>> {
  try {
    console.log(`[Acontext] listArtifactsRecursive: Listing path "${path}" in disk "${diskId}"`);
    
    // List artifacts and directories in the current path
    const result = await acontext!.disks.artifacts.list(diskId, {
      path: path,
    });

    console.log(`[Acontext] listArtifactsRecursive: API response for path "${path}":`, {
      hasResult: !!result,
      artifactsCount: Array.isArray(result?.artifacts) ? result.artifacts.length : 0,
      directoriesCount: Array.isArray(result?.directories) ? result.directories.length : 0,
      rawArtifacts: result?.artifacts,
      rawDirectories: result?.directories,
    });

    if (!result) {
      console.warn(`[Acontext] listArtifactsRecursive: No result returned for path "${path}"`);
      return allArtifacts;
    }

    // Normalize and add files from current directory
    const items = Array.isArray(result.artifacts) ? result.artifacts : [];
    const normalizedArtifacts = items.map((item: any) => {
      // Extract metadata if available
      const artifactInfo = item.meta?.__artifact_info__;
      
      // Build full path (directory + filename)
      // Acontext's API/dashboard exposes directory + filename separately, e.g.:
      //   path: "/generated/2026-01-15/"
      //   filename: "image_xxx.jpg"
      // We want the frontend to receive a single full path:
      //   "/generated/2026-01-15/image_xxx.jpg"
      let fullPath: string;
      const rawPath: string | undefined = item.path;
      const rawFilename: string | undefined = item.filename;

      if (rawPath && rawPath !== "/") {
        const basePath = rawPath.endsWith("/") ? rawPath : `${rawPath}/`;
        if (rawFilename) {
          fullPath = `${basePath}${rawFilename}`;
        } else {
          // Directory entry (no filename) - keep the directory path itself.
          fullPath = basePath;
        }
      } else if (rawFilename) {
        // File in the root directory: "/file.ext"
        fullPath = `/${rawFilename}`;
      } else {
        // If both are missing, fall back to raw path or a placeholder.
        fullPath = rawPath || "unknown";
      }
      
      // Extract size from metadata if available
      let size = item.size || item.length || 0;
      if (artifactInfo && typeof artifactInfo === 'object') {
        size = artifactInfo.size || artifactInfo.length || size;
      }
      
      // Extract MIME type from metadata if available
      // According to docs: __artifact_info__ contains content_type
      let mimeType = item.mimeType || item.contentType || 'application/octet-stream';
      if (artifactInfo && typeof artifactInfo === 'object') {
        mimeType = artifactInfo.content_type || artifactInfo.contentType || 
                   artifactInfo.mimeType || artifactInfo.type || mimeType;
      }
      
      // Infer MIME type from file extension if still generic or missing
      const filename = rawFilename || fullPath.split('/').pop() || '';
      if (mimeType === 'application/octet-stream' || !mimeType) {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          bmp: 'image/bmp',
          ico: 'image/x-icon',
          txt: 'text/plain',
          json: 'application/json',
          js: 'application/javascript',
          jsx: 'application/javascript',
          ts: 'application/typescript',
          tsx: 'application/typescript',
          html: 'text/html',
          css: 'text/css',
          xml: 'application/xml',
          yaml: 'application/yaml',
          yml: 'application/yaml',
          md: 'text/markdown',
          sh: 'application/x-sh',
        };
        if (mimeMap[ext]) {
          mimeType = mimeMap[ext];
        }
      }
      
      const normalized = {
        id: fullPath, // Use full path as ID
        path: fullPath, // Use full path
        filename: filename || 'unknown',
        mimeType: mimeType,
        size: size,
      createdAt: item.createdAt || item.created_at || item.timestamp,
      };
      
      console.log(`[Acontext] listArtifactsRecursive: Normalizing artifact:`, {
        rawItem: {
          ...item,
          meta: item.meta ? JSON.parse(JSON.stringify(item.meta)) : undefined, // Deep clone for logging
        },
        artifactInfo: artifactInfo ? JSON.parse(JSON.stringify(artifactInfo)) : undefined,
        normalized: normalized,
      });
      
      return normalized;
    });

    allArtifacts.push(...normalizedArtifacts);

    // Recursively list subdirectories
    const directories = Array.isArray(result.directories) ? result.directories : [];
    for (const directory of directories) {
      // Ensure path ends with / for proper directory traversal
      const dirPath = directory.startsWith('/') ? directory : `${path}${path.endsWith('/') ? '' : '/'}${directory}`;
      const normalizedPath = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
      await listArtifactsRecursive(acontext, diskId, normalizedPath, allArtifacts);
    }

    return allArtifacts;
  } catch (error) {
    console.warn(`[Acontext] Failed to list artifacts from path ${path}:`, error);
    return allArtifacts;
  }
}

/**
 * List artifacts from Acontext Disk (recursively)
 * Returns an array of artifacts or null if listing fails
 */
export async function listAcontextArtifacts(
  diskId?: string
): Promise<Array<{ id?: string; path?: string; filename?: string; mimeType?: string; size?: number; createdAt?: string }> | null> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return null;
  }

  try {
    // If no diskId provided, list disks and use the first one
    let targetDiskId = diskId;
    if (!targetDiskId) {
      const disks = await acontext.disks.list();
      if (disks && disks.items && disks.items.length > 0) {
        targetDiskId = disks.items[0].id;
      } else {
        console.debug("[Acontext] No disks found");
        return [];
      }
    }

    console.debug("[Acontext] Listing artifacts recursively", {
      diskId: targetDiskId,
    });

    // Recursively list all artifacts starting from root
    const allArtifacts = await listArtifactsRecursive(acontext, targetDiskId, "/");

    console.debug("[Acontext] Found artifacts", {
      count: allArtifacts.length,
    });

    return allArtifacts;
  } catch (error) {
    await logAcontextError("Failed to list artifacts", error, {
      diskId,
    });
    return null;
  }
}

/**
 * Get artifact content from Acontext Disk
 * Returns the file content as Buffer or null if retrieval fails
 * Also returns publicUrl if available for direct access
 */
export async function getAcontextArtifactContent(
  filePath: string,
  diskId?: string
): Promise<{ content: Buffer; mimeType: string; publicUrl?: string } | null> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return null;
  }

  try {
    const inferMimeTypeFromFilename = (name: string): string | undefined => {
      const ext = name.split(".").pop()?.toLowerCase() || "";
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
        markdown: "text/markdown",
        sh: "application/x-sh",
      };
      return mimeMap[ext];
    };

    // If no diskId provided, list disks and use the first one
    let targetDiskId = diskId;
    if (!targetDiskId) {
      const disks = await acontext.disks.list();
      if (disks && disks.items && disks.items.length > 0) {
        targetDiskId = disks.items[0].id;
      } else {
        console.debug("[Acontext] No disks found");
        return null;
      }
    }

    console.log("[Acontext] getAcontextArtifactContent: Starting", {
      diskId: targetDiskId,
      filePath,
      filePathType: typeof filePath,
      filePathLength: filePath?.length,
    });

    // Validate filePath - it should not be a directory path
    if (!filePath || filePath === '/' || filePath.endsWith('/')) {
      console.warn("[Acontext] getAcontextArtifactContent: Invalid filePath - cannot download directory", { 
        filePath,
        isEmpty: !filePath,
        isRoot: filePath === '/',
        endsWithSlash: filePath?.endsWith('/'),
      });
      return null;
    }

    // Extract filename and path from filePath
    // filePath format: "/path/to/file.txt" or "file.txt"
    const pathParts = filePath.split('/').filter(part => part.length > 0);
    
    if (pathParts.length === 0) {
      console.warn("[Acontext] Invalid filePath: no filename found", { filePath });
      return null;
    }
    
    const filename = pathParts[pathParts.length - 1];
    const filePathDir = pathParts.length > 1 
      ? '/' + pathParts.slice(0, -1).join('/') 
      : '/';
    
    console.log("[Acontext] getAcontextArtifactContent: Parsed path components", {
      originalFilePath: filePath,
      pathParts,
      filename,
      filePathDir,
      pathPartsLength: pathParts.length,
    });
    
    // Validate filename is not empty
    if (!filename || filename.trim() === '') {
      console.warn("[Acontext] getAcontextArtifactContent: Invalid filePath - empty filename", { 
        filePath,
        pathParts,
        filename,
      });
      return null;
    }
    
    // Use disks.artifacts.get API instead of download_file tool
    console.log("[Acontext] getAcontextArtifactContent: Calling disks.artifacts.get API", {
      diskId: targetDiskId,
      filePath: filePathDir,
      filename,
    });
    
    const result = await acontext.disks.artifacts.get(targetDiskId, {
      filePath: filePathDir,
      filename,
      withContent: true,
      withPublicUrl: true,
    });
    
    console.log("[Acontext] getAcontextArtifactContent: artifacts.get result", {
      hasResult: !!result,
      hasArtifact: !!result?.artifact,
      hasContent: !!result?.content,
      hasPublicUrl: !!result?.public_url,
      contentType: result?.content?.type,
      artifactMimeType: (result?.artifact as any)?.mimeType,
    });

    // Get MIME type - prioritize file extension inference over API response
    // This ensures correct MIME types even if API returns incorrect ones (e.g., text/html for .md files)
    let mimeType = "application/octet-stream";
    
    // First, try to infer from file extension (most reliable for known file types)
    const inferredFromExt = inferMimeTypeFromFilename(filename);
    if (inferredFromExt) {
      mimeType = inferredFromExt;
      console.log("[Acontext] getAcontextArtifactContent: Inferred MIME type from extension", {
        extension: filename.split('.').pop()?.toLowerCase() || '',
        mimeType,
      });
    }
    
    // Then check API response (but only if extension inference didn't find a match)
    // This allows API to override for unknown extensions, but prevents API errors from affecting known types
    if (mimeType === "application/octet-stream") {
      // Try to get from content.type if available
      if (result?.content) {
        const contentData = result.content as any;
        if (contentData.type && contentData.type !== "application/octet-stream") {
          mimeType = contentData.type;
        }
      }
      
      // Then check artifact metadata (__artifact_info__.content_type as per docs)
      if (mimeType === "application/octet-stream" && result?.artifact) {
        const artifact = result.artifact as any;
        
        // Check __artifact_info__.content_type first (as per docs)
        const artifactInfo = artifact.meta?.__artifact_info__;
        if (artifactInfo && typeof artifactInfo === 'object') {
          mimeType = artifactInfo.content_type || artifactInfo.contentType || 
                     artifactInfo.mimeType || artifactInfo.type || mimeType;
        }
        
        // Fallback to artifact-level properties if still generic
        if (mimeType === "application/octet-stream") {
          mimeType = artifact.mimeType || artifact.contentType || mimeType;
        }
      }
      
      if (mimeType !== "application/octet-stream") {
        console.log("[Acontext] getAcontextArtifactContent: Using MIME type from API", {
          mimeType,
        });
      }
    }

    // Get file content from the result
    let content: Buffer;

    const looksLikeBase64 = (value: string): boolean => {
      // Fast, conservative check: base64 chars + optional padding, and length multiple of 4
      const s = value.trim();
      if (s.length < 16) return false;
      if (s.length % 4 !== 0) return false;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
      return true;
    };
    
    if (result?.content) {
      // Content is available directly from the API
      const contentData = result.content as any;
      
      // IMPORTANT: For text files, prioritize content.text over content.raw
      // According to Acontext docs, text files return content.text which is already parsed
      // Using content.text ensures we get the complete, correctly decoded text content
      if (contentData.text) {
        // Text content (for text files) - this is the preferred format for text files
        // content.text is already a string, so we convert it to Buffer for consistency
        content = Buffer.from(contentData.text, "utf-8");
        // Truncate text content to 200 characters for logging
        const textPreview = contentData.text.length > 200 
          ? contentData.text.substring(0, 200) + '...' 
          : contentData.text;
        console.log("[Acontext] getAcontextArtifactContent: Using content.text (preferred for text files)", {
          bufferLength: content.length,
          textLength: contentData.text.length,
          textPreview,
          hasRaw: !!contentData.raw,
        });
      } else if (contentData.raw) {
        // Raw content (for binary files like images, or text files when text is not available)
        if (Buffer.isBuffer(contentData.raw)) {
          content = contentData.raw;
        } else if (contentData.raw instanceof ArrayBuffer) {
          content = Buffer.from(contentData.raw);
        } else if (ArrayBuffer.isView(contentData.raw)) {
          // Uint8Array / DataView / etc.
          const view = contentData.raw as ArrayBufferView;
          content = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
        } else if (
          typeof contentData.raw === "object" &&
          contentData.raw &&
          (contentData.raw as any).type === "Buffer" &&
          Array.isArray((contentData.raw as any).data)
        ) {
          // Some clients serialize Buffers as { type: "Buffer", data: number[] }
          content = Buffer.from((contentData.raw as any).data);
        } else if (typeof contentData.raw === "string") {
          // Acontext may return either:
          // - base64 encoded string (binary)
          // - plain text string (already decoded)
          // We must not blindly base64-decode, or text previews become garbled (e.g. "j�p").
          const rawStr = contentData.raw;
          if (looksLikeBase64(rawStr)) {
            try {
              const decoded = Buffer.from(rawStr, "base64");
              // Heuristic: if decoding results in an extremely small buffer compared to input,
              // it might be accidental (plain text). Prefer returning plain text bytes then.
              if (decoded.length > 0 && decoded.length < rawStr.length) {
                content = decoded;
              } else {
                content = Buffer.from(rawStr, "utf-8");
              }
            } catch {
              content = Buffer.from(rawStr, "utf-8");
            }
          } else {
            content = Buffer.from(rawStr, "utf-8");
          }
        } else {
          console.warn("[Acontext] Unexpected content.raw format", typeof contentData.raw);
          return null;
        }
        
        // If content type is text, try to decode and show text preview
        const isTextContent = contentData.type === 'text' || 
                             (typeof contentData.type === 'string' && contentData.type.startsWith('text/'));
        const logData: any = {
          bufferLength: content.length,
          contentType: contentData.type,
        };
        
        if (isTextContent && content.length > 0) {
          try {
            // Try UTF-8 decoding first
            let textContent = content.toString("utf-8");
            const hasInvalidUtf8 = textContent.includes('\uFFFD'); // Replacement character indicates invalid UTF-8
            
            // If UTF-8 decoding failed, try latin1 encoding as fallback
            if (hasInvalidUtf8) {
              textContent = content.toString("latin1");
              logData.hasInvalidUtf8 = true;
              logData.fallbackEncoding = 'latin1';
            }
            
            const textPreview = textContent.length > 200 
              ? textContent.substring(0, 200) + '...' 
              : textContent;
            
            // For very small buffers, also show hex representation for debugging
            if (content.length <= 20) {
              logData.hexPreview = content.toString('hex');
            }
            
            logData.textLength = textContent.length;
            logData.textPreview = textPreview;
          } catch (e) {
            // If UTF-8 decoding fails, it's probably not text
            logData.textDecodeError = e instanceof Error ? e.message : String(e);
            logData.hexPreview = content.toString('hex');
          }
        }
        
        console.log("[Acontext] getAcontextArtifactContent: Using content.raw (fallback)", logData);
      } else {
        console.warn("[Acontext] Content object missing both raw and text properties", {
          contentKeys: Object.keys(contentData),
        });
        return null;
      }
    } else if (result?.public_url) {
      // If content is not available but public_url is, fetch from URL
      console.log("[Acontext] getAcontextArtifactContent: Fetching content from public_url", {
        publicUrl: result.public_url,
      });
      
      try {
        const urlResponse = await fetch(result.public_url, {
          // Disable compression to ensure we get the full content
          headers: {
            'Accept-Encoding': 'identity',
          },
        });
        
        if (!urlResponse.ok) {
          throw new Error(`Failed to fetch from public URL: ${urlResponse.status} ${urlResponse.statusText}`);
        }
        
        // Log response headers for debugging
        const contentLength = urlResponse.headers.get('content-length');
        const contentType = urlResponse.headers.get('content-type');
        console.log("[Acontext] getAcontextArtifactContent: Response headers", {
          status: urlResponse.status,
          statusText: urlResponse.statusText,
          contentLength,
          contentType,
          headers: Object.fromEntries(urlResponse.headers.entries()),
        });
        
        // For text files, try using text() first to ensure proper encoding
        const inferredMimeType = inferMimeTypeFromFilename(filename);
        const isLikelyText = inferredMimeType?.startsWith('text/') || 
                            inferredMimeType === 'application/json' ||
                            inferredMimeType === 'application/xml' ||
                            inferredMimeType === 'text/markdown';
        
        if (isLikelyText) {
          // Try text() first for text files
          try {
            const textContent = await urlResponse.text();
            content = Buffer.from(textContent, 'utf-8');
            console.log("[Acontext] getAcontextArtifactContent: Fetched text content from URL", {
              bufferLength: content.length,
              textLength: textContent.length,
              preview: textContent.substring(0, 100),
            });
          } catch (textError) {
            console.warn("[Acontext] Failed to read as text, falling back to arrayBuffer", textError);
            // Fallback to arrayBuffer
            const arrayBuffer = await urlResponse.arrayBuffer();
            content = Buffer.from(arrayBuffer);
            console.log("[Acontext] getAcontextArtifactContent: Fetched binary content from URL (fallback)", {
              bufferLength: content.length,
            });
          }
        } else {
          // For binary files, use arrayBuffer
          const arrayBuffer = await urlResponse.arrayBuffer();
          content = Buffer.from(arrayBuffer);
          console.log("[Acontext] getAcontextArtifactContent: Fetched binary content from URL", {
            bufferLength: content.length,
            expectedLength: contentLength ? parseInt(contentLength, 10) : undefined,
          });
        }
        
        // Verify content length matches header if available
        if (contentLength) {
          const expectedLength = parseInt(contentLength, 10);
          if (content.length !== expectedLength) {
            console.warn("[Acontext] Content length mismatch!", {
              expected: expectedLength,
              actual: content.length,
              difference: expectedLength - content.length,
            });
          }
        }
      } catch (fetchError) {
        console.error("[Acontext] Failed to fetch content from public URL", fetchError);
        return null;
      }
    } else {
      console.warn("[Acontext] No content or public_url available in result");
      return null;
    }
    
    // Keep logging concise: only meta information, no raw buffer data
    console.log("[Acontext] getAcontextArtifactContent: Final content Buffer", {
      bufferLength: content.length,
      mimeType,
    });

    console.debug("[Acontext] Artifact content retrieved successfully", {
      size: content.length,
      mimeType,
      hasPublicUrl: !!result?.public_url,
    });

    return { 
      content, 
      mimeType,
      publicUrl: result?.public_url || undefined,
    };
  } catch (error) {
    await logAcontextError("Failed to get artifact content", error, {
      filePath,
      diskId,
    });
    return null;
  }
}

/**
 * Store a message in Acontext session
 * Supports both string content and Vision API format (array with images)
 */
export async function storeMessageInAcontext(
  acontextSessionId: string,
  role: "user" | "assistant" | "system",
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >,
  format: "openai" | "anthropic" | "gemini" = "openai"
): Promise<boolean> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return false;
  }

  try {
    // Build message blob in the format expected by Acontext
    // For OpenAI format, we can pass a simple object
    // Support both string and array (Vision API) formats
    const messageBlob: Record<string, unknown> = {
      role,
      content,
    };
    
    const contentLength = typeof content === "string" 
      ? content.length 
      : JSON.stringify(content).length;
    
    console.debug("[Acontext] Storing message", {
      acontextSessionId,
      role,
      contentLength,
      isArray: Array.isArray(content),
      format,
    });
    
    await acontext.sessions.storeMessage(acontextSessionId, messageBlob, {
      format,
    });
    
    console.debug("[Acontext] Message stored successfully");
    return true;
  } catch (error) {
    await logAcontextError("Failed to store message", error, {
      acontextSessionId,
      role,
      contentLength: typeof content === "string" ? content.length : JSON.stringify(content).length,
      format,
    });
    return false;
  }
}

/**
 * Get token counts for an Acontext session
 * Returns token count information or null if unavailable
 */
export async function getAcontextTokenCounts(
  acontextSessionId: string
): Promise<TokenCounts | null> {
  const acontext = getAcontextClient();
  if (!acontext || !acontextSessionId) {
    return null;
  }

  try {
    console.debug("[Acontext] Getting token counts", {
      acontextSessionId,
    });

    const tokenCounts = await acontext.sessions.getTokenCounts(acontextSessionId);

    if (!tokenCounts) {
      console.debug("[Acontext] No token counts available");
      return null;
    }

    console.debug("[Acontext] Token counts retrieved", {
      total_tokens: tokenCounts.total_tokens,
    });

    return {
      total_tokens: tokenCounts.total_tokens || 0,
    };
  } catch (error) {
    await logAcontextError("Failed to get token counts", error, {
      acontextSessionId,
    });
    return null;
  }
}

/**
 * Determine which edit strategies to apply based on token count and message analysis
 * This implements automatic context editing (Plan A)
 * 
 * @param tokenCounts - Current token counts for the session
 * @param messages - Current messages in the session (for tool call analysis)
 * @param config - Configuration for thresholds and strategy parameters
 * @returns Array of edit strategies to apply, or empty array if none needed
 */
export function determineEditStrategies(
  tokenCounts: TokenCounts | null,
  messages: Array<{ role: string; toolCalls?: unknown }>,
  config?: {
    tokenLimitThreshold?: number; // Default: 80% of model limit
    tokenLimitTarget?: number; // Default: 70% of model limit
    toolResultThreshold?: number; // Default: 5 tool results
    toolCallThreshold?: number; // Default: 10 tool calls
  }
): EditStrategy[] {
  const strategies: EditStrategy[] = [];

  // Default configuration
  const tokenLimitThreshold = config?.tokenLimitThreshold ?? 80000; // 80K tokens (80% of 100K model)
  const tokenLimitTarget = config?.tokenLimitTarget ?? 70000; // 70K tokens (70% of 100K model)
  const toolResultThreshold = config?.toolResultThreshold ?? 5;
  const toolCallThreshold = config?.toolCallThreshold ?? 10;

  // If no token counts available, skip automatic strategies
  if (!tokenCounts || tokenCounts.total_tokens === 0) {
    return strategies;
  }

  // Count tool calls and tool results in messages
  let toolCallCount = 0;
  let toolResultCount = 0;
  
  for (const msg of messages) {
    if (msg.toolCalls) {
      const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [msg.toolCalls];
      toolCallCount += toolCalls.length;
    }
    if (msg.role === "tool") {
      toolResultCount++;
    }
  }

  console.debug("[Acontext] Analyzing context for edit strategies", {
    total_tokens: tokenCounts.total_tokens,
    tokenLimitThreshold,
    toolCallCount,
    toolResultCount,
  });

  // Strategy 1: Apply token_limit if exceeding threshold
  if (tokenCounts.total_tokens > tokenLimitThreshold) {
    strategies.push({
      type: "token_limit",
      params: {
        limit_tokens: tokenLimitTarget,
      },
    });
    console.debug("[Acontext] Auto-applying token_limit strategy", {
      limit_tokens: tokenLimitTarget,
    });
  }

  // Strategy 2: Apply remove_tool_result if many tool results exist
  // Only apply if we haven't already applied token_limit (to avoid double-processing)
  if (toolResultCount > toolResultThreshold && strategies.length === 0) {
    strategies.push({
      type: "remove_tool_result",
      params: {
        keep_recent_n_tool_results: Math.max(3, Math.floor(toolResultThreshold / 2)),
        tool_result_placeholder: "Done",
      },
    });
    console.debug("[Acontext] Auto-applying remove_tool_result strategy", {
      keep_recent_n_tool_results: Math.max(3, Math.floor(toolResultThreshold / 2)),
    });
  }

  // Strategy 3: Apply remove_tool_call_params if many tool calls exist
  // Only apply if we haven't already applied other strategies
  if (toolCallCount > toolCallThreshold && strategies.length === 0) {
    strategies.push({
      type: "remove_tool_call_params",
      params: {
        keep_recent_n_tool_calls: Math.max(3, Math.floor(toolCallThreshold / 2)),
      },
    });
    console.debug("[Acontext] Auto-applying remove_tool_call_params strategy", {
      keep_recent_n_tool_calls: Math.max(3, Math.floor(toolCallThreshold / 2)),
    });
  }

  return strategies;
}

/**
 * Load messages from Acontext session
 * Returns messages in ChatMessage format
 * Supports optional edit strategies for context editing
 * 
 * @param acontextSessionId - The Acontext session ID
 * @param editStrategies - Optional array of edit strategies to apply (on-the-fly editing, doesn't modify storage)
 * @returns Array of chat messages
 */
export async function loadMessagesFromAcontext(
  acontextSessionId: string,
  editStrategies?: EditStrategy[]
): Promise<Array<{
  id?: string;
  sessionId?: string;
  role: "user" | "assistant" | "system";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
  createdAt?: Date | string;
  toolCalls?: import("@/types/chat").ToolInvocation[];
}>> {
  const acontext = getAcontextClient();
  if (!acontext || !acontextSessionId) {
    return [];
  }

  try {
    console.debug("[Acontext] Loading messages", {
      acontextSessionId,
      editStrategies: editStrategies?.length || 0,
    });
    
    // Build options with optional edit strategies
    const options: {
      format: "openai" | "anthropic" | "gemini" | "acontext";
      editStrategies?: EditStrategy[];
    } = {
      format: "openai",
    };

    if (editStrategies && editStrategies.length > 0) {
      options.editStrategies = editStrategies;
      console.debug("[Acontext] Applying edit strategies", {
        strategies: editStrategies.map((s) => s.type),
      });
    }
    
    const messages = await acontext.sessions.getMessages(acontextSessionId, options);

    if (!messages || !messages.items || messages.items.length === 0) {
      console.debug("[Acontext] No messages found in session");
      return [];
    }

    // Convert Acontext messages to ChatMessage format
    const chatMessages = messages.items.map((msg: any, index: number) => {
      // Extract content - handle both string and array formats
      // Preserve Vision API format (array) so images can be used as context
      let content: string | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Preserve Vision API format (array) for images
        content = msg.content;
      } else {
        content = String(msg.content);
      }

      return {
        id: msg.id || `acontext-${index}`,
        sessionId: acontextSessionId,
        role: (msg.role || "user") as "user" | "assistant" | "system",
        content,
        createdAt: msg.created_at || msg.timestamp || new Date(),
        toolCalls: msg.tool_calls || undefined,
      };
    });

    console.debug("[Acontext] Loaded messages", {
      count: chatMessages.length,
      strategiesApplied: editStrategies?.length || 0,
    });

    return chatMessages;
  } catch (error) {
    await logAcontextError("Failed to load messages", error, {
      acontextSessionId,
      editStrategies: editStrategies?.map((s) => s.type),
    });
    return [];
  }
}

/**
 * Create a new Acontext session directly (without Supabase chat_sessions table)
 * Returns the Acontext session ID and creates a minimal mapping in Supabase
 */
export async function createAcontextSessionDirectly(
  userId: string,
  title?: string
): Promise<{ acontextSessionId: string; sessionId: string } | null> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return null;
  }

  try {
    // Resolve (or lazily create) the user's default Space for skill learning
    const spaceId = await getOrCreateUserSpaceId(userId);

    // Create session in Acontext with userId in configs and optional space binding
    const configs = {
      userId,
      source: "nextjs-with-supabase-chatbot",
    };
    
    console.debug("[Acontext] Creating session directly", {
      userId,
      configs,
      spaceId,
    });

    const sessionCreatePayload: Record<string, unknown> = {
      configs,
    };

    if (spaceId) {
      // Attach this session to the user's long-lived Space so completed tasks
      // can be learned as reusable skills/SOPs.
      (sessionCreatePayload as any).spaceId = spaceId;
    }

    const acontextSession = await acontext.sessions.create(
      sessionCreatePayload as any
    );

    console.debug("[Acontext] Session created successfully", {
      acontextSessionId: acontextSession.id,
    });

    // Create a dedicated Disk for this session
    let diskId: string | undefined;
    try {
      const disk = await acontext.disks.create();
      diskId = disk.id;
      console.debug("[Acontext] Created dedicated disk for session", {
        diskId,
        acontextSessionId: acontextSession.id,
      });
    } catch (error) {
      await logAcontextError("Failed to create disk for session", error, {
        acontextSessionId: acontextSession.id,
        userId,
      });
      // Continue without disk - session will still work
    }

    // Store minimal mapping in Supabase (only for querying/sorting)
    // Use acontext_session_id as the primary identifier
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    
    // Insert into chat_sessions with acontext_session_id as the primary key
    // We'll use acontext_session_id as the session ID for the frontend
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({
        id: acontextSession.id, // Use Acontext session ID as our session ID
        user_id: userId,
        acontext_session_id: acontextSession.id,
        acontext_space_id: spaceId ?? null,
        acontext_disk_id: diskId,
        title: title || "New Chat",
      })
      .select()
      .single();

    if (error) {
      console.warn("[Acontext] Failed to store mapping in Supabase:", error.message);
      // Continue anyway - the session exists in Acontext
    }

    return {
      acontextSessionId: acontextSession.id,
      sessionId: acontextSession.id, // Use Acontext session ID as session ID
    };
  } catch (error) {
    await logAcontextError("Failed to create Acontext session directly", error, {
      userId,
      title,
    });
    return null;
  }
}

/**
 * Delete an Acontext session
 */
export async function deleteAcontextSession(
  acontextSessionId: string
): Promise<boolean> {
  const acontext = getAcontextClient();
  if (!acontext) {
    return false;
  }

  try {
    console.debug("[Acontext] Deleting session", {
      acontextSessionId,
    });

    // Try to delete from Acontext (if API supports it)
    // Note: Acontext SDK might not have a delete method, so we'll just remove from Supabase
    // The session in Acontext will remain but won't be accessible through our app
    
    // For now, we'll just remove the mapping from Supabase
    // If Acontext SDK supports deletion, we can add it here
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    
    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("acontext_session_id", acontextSessionId);

    if (error) {
      console.warn("[Acontext] Failed to delete mapping from Supabase:", error.message);
      return false;
    }

    console.debug("[Acontext] Session deleted successfully");
    return true;
  } catch (error) {
    await logAcontextError("Failed to delete Acontext session", error, {
      acontextSessionId,
    });
    return false;
  }
}

