import { NextRequest, NextResponse } from "next/server";

import { getAcontextArtifactContent } from "@/lib/acontext-integration";
import { getAcontextClient } from "@/lib/acontext-client";

/**
 * GET /api/acontext/artifacts/content
 * Get artifact content from Acontext Disk
 * 
 * Query parameters:
 * - filePath (required): Path to the file in the disk
 * - diskId (optional): Specific disk ID to get artifact from
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get("filePath");
    const diskId = searchParams.get("diskId") || undefined;
    const metaOnly = searchParams.get("metaOnly") === "true";

    console.log("[API] GET /api/acontext/artifacts/content: Request received", {
      filePath,
      diskId,
      metaOnly,
      allParams: Object.fromEntries(searchParams.entries()),
    });

    if (!filePath) {
      console.warn("[API] GET /api/acontext/artifacts/content: Missing filePath parameter");
      return NextResponse.json(
        {
          success: false,
          error: "filePath parameter is required",
        },
        { status: 400 }
      );
    }

    // Fast path: metadata-only lookup (used by UI to get publicUrl, mimeType, size)
    if (metaOnly) {
      const acontext = getAcontextClient();
      if (!acontext) {
        return NextResponse.json(
          {
            success: false,
            error: "Acontext is not configured",
          },
          { status: 500 }
        );
      }

      // Small helper to infer mime type from filename
      const inferMimeTypeFromFilename = (name: string | null): string | undefined => {
        const ext = name?.split(".").pop()?.toLowerCase() || "";
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

      // Resolve disk id if not provided (mirror getAcontextArtifactContent behaviour)
      let targetDiskId = diskId;
      if (!targetDiskId) {
        const disks = await acontext.disks.list();
        if (disks && disks.items && disks.items.length > 0) {
          targetDiskId = disks.items[0].id;
        } else {
          console.debug("[API] /artifacts/content metaOnly: No disks found");
          return NextResponse.json(
            {
              success: false,
              error: "No Acontext disks found",
            },
            { status: 404 }
          );
        }
      }

      // Detect directory paths (ending with /) - these should not be requested as files
      if (filePath.endsWith("/")) {
        console.warn("[API] /artifacts/content metaOnly: filePath is a directory, not a file", {
          filePath,
          diskId: targetDiskId,
        });
        return NextResponse.json(
          {
            success: false,
            error: "filePath is a directory, not a file. Use list API to list directory contents.",
          },
          { status: 400 }
        );
      }

      // Parse path into directory + filename ("/dir/file.png" → { "/", "file.png" })
      const pathParts = filePath.split("/").filter((part) => part.length > 0);
      if (pathParts.length === 0) {
        console.warn("[API] /artifacts/content metaOnly: Invalid filePath (no filename)", {
          filePath,
        });
        return NextResponse.json(
          {
            success: false,
            error: "Invalid filePath",
          },
          { status: 400 }
        );
      }

      const filename = pathParts[pathParts.length - 1];
      const filePathDir =
        pathParts.length > 1 ? "/" + pathParts.slice(0, -1).join("/") : "/";

      console.log("[API] /artifacts/content metaOnly: Parsed filePath", {
        originalFilePath: filePath,
        filePathDir,
        filename,
        diskId: targetDiskId,
      });

      let artifactsGetResult;
      try {
        artifactsGetResult = await acontext.disks.artifacts.get(targetDiskId, {
          filePath: filePathDir,
          filename,
          withContent: false,
          withPublicUrl: true,
        });
      } catch (apiError) {
        console.error("[API] /artifacts/content metaOnly: artifacts.get failed", {
          diskId: targetDiskId,
          filePathDir,
          filename,
          originalFilePath: filePath,
          error: apiError instanceof Error ? apiError.message : String(apiError),
          errorStack: apiError instanceof Error ? apiError.stack : undefined,
        });
        throw apiError;
      }

      if (!artifactsGetResult || !artifactsGetResult.artifact) {
        return NextResponse.json(
          {
            success: false,
            error: "Artifact not found",
          },
          { status: 404 }
        );
      }

      const artifact: any = artifactsGetResult.artifact;
      const artifactInfo = artifact.meta?.__artifact_info__ ?? {};

      // Prefer typed size from artifact info, then fall back to size on artifact
      const size: number | undefined =
        typeof artifactInfo.size === "number"
          ? artifactInfo.size
          : typeof artifact.size === "number"
          ? artifact.size
          : undefined;

      // Determine mime type: first from extension, then from artifact/meta
      let mimeType =
        inferMimeTypeFromFilename(artifactInfo.filename || artifact.filename) ||
        artifactInfo.content_type ||
        artifactInfo.contentType ||
        artifactInfo.mimeType ||
        artifact.mimeType ||
        artifact.contentType ||
        "application/octet-stream";

      console.log("[API] /artifacts/content metaOnly: Resolved metadata", {
        diskId: targetDiskId,
        filePath,
        filePathDir,
        filename,
        size,
        mimeType,
        hasPublicUrl: !!artifactsGetResult.public_url,
      });

      return NextResponse.json({
        success: true,
        content: null,
        mimeType,
        size,
        publicUrl: artifactsGetResult.public_url || null,
        isText: false,
        metaOnly: true,
      });
    }

    // Full-content path (used when UI explicitly needs file data)
    const result = await getAcontextArtifactContent(filePath, diskId);

    // Only log a small, high-level summary to avoid flooding logs with large buffers/base64
    console.log("[API] GET /api/acontext/artifacts/content: getAcontextArtifactContent result", {
      hasResult: !!result,
      resultType: typeof result,
      mimeType: result?.mimeType,
      contentLength: result?.content?.length,
      hasPublicUrl: !!result?.publicUrl,
    });

    if (result === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to get artifact content. File may not exist or Acontext may not be configured.",
        },
        { status: 404 }
      );
    }

    // Helper function to detect if a file is a text file based on MIME type
    const isTextFile = (mimeType: string): boolean => {
      if (!mimeType) return false;
      // Handle generic 'text' type
      if (mimeType === 'text') {
        return true;
      }
      const textMimeTypes = [
        'text/',
        'application/json',
        'application/xml',
        'application/javascript',
        'application/typescript',
        'application/x-sh',
        'application/x-bash',
        'application/x-python',
        'application/x-yaml',
        'application/x-toml',
        'application/x-markdown',
        'application/x-csv',
      ];
      return textMimeTypes.some(type => mimeType.startsWith(type) || mimeType === type);
    };

    const isText = isTextFile(result.mimeType);
    
    // For text files, return text content directly to avoid base64 encoding/decoding issues
    // For binary files (images, etc.), return base64 encoded content
    if (isText) {
      // Try UTF-8 decoding first
      let textContent = result.content.toString("utf-8");
      const hasInvalidUtf8 = textContent.includes('\uFFFD'); // Replacement character indicates invalid UTF-8
      
      // If UTF-8 decoding failed, try latin1 encoding as fallback
      if (hasInvalidUtf8 && result.content.length > 0) {
        console.warn("[API] GET /api/acontext/artifacts/content: Invalid UTF-8 detected, trying latin1 encoding", {
          bufferHex: result.content.toString('hex'),
          bufferLength: result.content.length,
        });
        textContent = result.content.toString("latin1");
      }
      
      // Only log meta information, not actual text content, to keep logs concise
      console.log("[API] GET /api/acontext/artifacts/content: Preparing text response", {
        bufferLength: result.content.length,
        textLength: textContent.length,
        mimeType: result.mimeType,
        hasPublicUrl: !!result.publicUrl,
        hasInvalidUtf8,
      });
      
      return NextResponse.json({
        success: true,
        content: textContent,
        mimeType: result.mimeType,
        size: result.content.length,
        publicUrl: result.publicUrl,
        isText: true, // Flag to indicate this is text content, not base64
      });
    } else {
      // For binary files, return base64 encoded content
      const base64Content = result.content.toString("base64");

      // Do not log base64 content itself to avoid massive log output
      console.log("[API] GET /api/acontext/artifacts/content: Preparing binary response", {
        bufferLength: result.content.length,
        base64Length: base64Content.length,
        mimeType: result.mimeType,
        hasPublicUrl: !!result.publicUrl,
      });
      
      return NextResponse.json({
        success: true,
        content: base64Content,
        mimeType: result.mimeType,
        size: result.content.length,
        publicUrl: result.publicUrl,
        isText: false, // Flag to indicate this is base64 encoded binary content
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    
    console.error("[API] Failed to get artifact content:", error);
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

