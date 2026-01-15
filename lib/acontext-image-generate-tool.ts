/**
 * Image Generate Tool (via third-party Gemini/OpenAI-Next compatible endpoint)
 *
 * Responsibilities:
 * - Expose a tool schema so the agent can call `image_generate`
 * - Call upstream image generation API
 * - Parse inlineData images (base64)
 * - Upload images to Acontext Disk (session disk) as artifacts
 */

import { uploadFileToAcontext } from "@/lib/acontext-integration";
import { getAcontextClient } from "@/lib/acontext-client";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";

export type ImageGenerateToolArgs = {
  /**
   * Prompt for image generation.
   */
  prompt: string;

  /**
   * Image size preset.
   */
  size?: "1K" | "2K" | "4K";

  /**
   * Optional output directory (within Acontext Disk).
   * Example: "generated_images" or "/generated_images".
   */
  output_dir?: string;
};

export type ImageGenerateToolResult = {
  /**
   * The generated image artifact path in Acontext Disk.
   * If generation fails or upstream returns no image, this is null.
   */
  artifactPath: string | null;
  /**
   * The generated thumbnail image artifact path in Acontext Disk.
   * This is a smaller, compressed version of the main image, suitable for previews.
   * If thumbnail generation or upload fails, this is null.
   */
  thumbnailPath?: string | null;
  /**
   * Public URL for directly viewing/downloading the generated image.
   * This is resolved from Acontext after upload. If not available, this is null.
   */
  publicUrl?: string | null;
  /**
   * Optional text returned by the upstream model (if any).
   */
  text?: string;
  /**
   * Human-friendly status message (keep it small to avoid context bloat).
   */
  message: string;
};

export const getImageGenerateToolSchema = {
  type: "function" as const,
  function: {
    name: "image_generate",
    description:
      "Generate one or more images from a text prompt. The image model is selected by the server from environment variables; the tool caller cannot override the model. Results are saved as artifacts to the current Acontext Disk.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Text prompt describing what to generate. Be specific about subject, style, lighting, composition, and constraints.",
        },
        size: {
          type: "string",
          enum: ["1K", "2K", "4K"],
          description: "Image size preset. Default: 1K.",
        },
        output_dir: {
          type: "string",
          description:
            "Optional output directory inside Acontext Disk. Example: \"generated_images\". Default: \"generated/YYYY-MM-DD\".",
        },
      },
      required: ["prompt"],
    },
  },
};

export function isImageGenerateToolName(name: string): boolean {
  return name === "image_generate";
}

function sanitizePathSegment(s: string): string {
  // Keep it conservative: only allow a-zA-Z0-9, dash, underscore, slash.
  // Strip leading/trailing whitespace and collapse backslashes.
  const normalized = s.trim().replace(/\\/g, "/");
  // Remove any .. segments
  const noDotDot = normalized
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
  // Remove characters that Acontext Disk might not like
  return noDotDot.replace(/[^a-zA-Z0-9/_-]/g, "_");
}

function extFromMimeType(mimeType: string): string {
  const mt = (mimeType || "").toLowerCase();
  if (mt.includes("png")) return "png";
  if (mt.includes("jpeg") || mt.includes("jpg")) return "jpg";
  if (mt.includes("webp")) return "webp";
  if (mt.includes("gif")) return "gif";
  return "bin";
}

function nowDateStamp(): string {
  // YYYY-MM-DD
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function randId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function runImageGenerate(
  args: ImageGenerateToolArgs,
  diskId?: string
): Promise<ImageGenerateToolResult> {
  if (!args || typeof args !== "object") {
    throw new Error("Arguments must be an object");
  }
  if (!args.prompt || typeof args.prompt !== "string" || !args.prompt.trim()) {
    throw new Error("prompt must be a non-empty string");
  }

  const prompt = args.prompt.trim();
  const size = (args.size ?? "1K") as NonNullable<ImageGenerateToolArgs["size"]>;
  const ratio = "16:9" as const;

  const apiKey = process.env.IMAGE_GEN_API_KEY;
  const baseUrl = process.env.IMAGE_GEN_BASE_URL;
  const model = process.env.IMAGE_GEN_DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error("IMAGE_GEN_API_KEY is not configured");
  }
  if (!model) {
    throw new Error("IMAGE_GEN_DEFAULT_MODEL is not configured");
  }

  // Output directory inside Acontext Disk
  const dateDir = `generated/${nowDateStamp()}`;
  const outputDir = args.output_dir ? sanitizePathSegment(args.output_dir) : dateDir;
  const prefix = outputDir ? outputDir.replace(/^\/+/, "").replace(/\/+$/, "") : dateDir;

  // Check if model supports imageSize parameter
  // Only gemini-3-pro-image-preview supports imageSize (1K, 2K, 4K)
  // gemini-2.5-flash-image only supports aspectRatio (fixed resolution)
  const supportsImageSize = model.includes("gemini-3-pro-image");

  console.log("[image-generate] calling upstream with SDK", {
    baseUrl: baseUrl || "(default)",
    model,
    size,
    ratio,
    promptLength: prompt.length,
    supportsImageSize,
    apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "(missing)",
  });

  // Initialize GoogleGenAI SDK
  let ai: GoogleGenAI;
  try {
    const initConfig: {
      apiKey: string;
      httpOptions?: { baseUrl: string };
    } = {
      apiKey,
    };
    
    if (baseUrl) {
      initConfig.httpOptions = { baseUrl };
    }
    
    console.log("[image-generate] Initializing GoogleGenAI SDK", {
      hasApiKey: !!apiKey,
      hasBaseUrl: !!baseUrl,
      baseUrl: baseUrl || "(using default)",
    });
    
    ai = new GoogleGenAI(initConfig);
  } catch (error) {
    console.error("[image-generate] Failed to initialize GoogleGenAI SDK", {
      error: error instanceof Error ? error.message : String(error),
      apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "(missing)",
      baseUrl: baseUrl || "(default)",
    });
    throw new Error(`Failed to initialize image generation SDK: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Prepare config based on model type
  // gemini-3-pro-image-preview: supports both aspectRatio and imageSize
  // gemini-2.5-flash-image: only supports aspectRatio (optional)
  let generateContentParams: {
    model: string;
    contents: string;
    config?: {
      imageConfig: {
        aspectRatio: string;
        imageSize?: string;
      };
    };
  } = {
    model,
    contents: prompt,
  };

  if (supportsImageSize) {
    // gemini-3-pro-image-preview: always pass config with aspectRatio and imageSize
    generateContentParams.config = {
      imageConfig: {
        aspectRatio: ratio,
        imageSize: size,
      },
    };
  } else {
    // gemini-2.5-flash-image: always pass config with aspectRatio (default: 16:9)
    generateContentParams.config = {
      imageConfig: {
        aspectRatio: ratio,
      },
    };
  }

  console.log("[image-generate] Calling ai.models.generateContent", {
    model: generateContentParams.model,
    promptLength: generateContentParams.contents.length,
    config: generateContentParams.config
      ? JSON.stringify(generateContentParams.config, null, 2)
      : null,
  });

  // Call SDK with a timeout to avoid hanging indefinitely on upstream issues
  const timeoutMs =
    (process.env.IMAGE_GEN_TIMEOUT_MS &&
      Number.parseInt(process.env.IMAGE_GEN_TIMEOUT_MS, 10)) ||
    120_000; // default 120s

  let response;
  try {
    const sdkPromise = ai.models.generateContent(generateContentParams);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Image generation API call timed out after ${timeoutMs}ms. ` +
              "This usually indicates the IMAGE_GEN_BASE_URL service is unreachable or very slow."
          )
        );
      }, timeoutMs);
    });

    response = await Promise.race([sdkPromise, timeoutPromise]);
  } catch (error) {
    console.error("[image-generate] SDK call failed", {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      model,
      baseUrl: baseUrl || "(default)",
      apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "(missing)",
      generateContentParams: {
        model: generateContentParams.model,
        contentsLength: generateContentParams.contents.length,
        config: generateContentParams.config
          ? JSON.stringify(generateContentParams.config, null, 2)
          : null,
      },
      timeoutMs,
    });

    // Re-throw with more context
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Image generation API call failed: ${errorMessage}. ` +
        "Check IMAGE_GEN_API_KEY, IMAGE_GEN_BASE_URL, network connectivity, and the upstream image service status."
    );
  }

  // Extract parts from response
  const parts: unknown[] =
    response?.candidates?.[0]?.content?.parts && Array.isArray(response.candidates[0].content.parts)
      ? response.candidates[0].content.parts
      : [];

  const images: Array<{ mimeType: string; data: string }> = [];
  let textOut: string | undefined = undefined;

  for (const p of parts) {
    const part = p as {
      inlineData?: { data?: unknown; mimeType?: unknown };
      text?: unknown;
    };
    if (part?.inlineData?.data && typeof part.inlineData.data === "string") {
      images.push({
        mimeType:
          typeof part.inlineData.mimeType === "string"
            ? part.inlineData.mimeType
            : "application/octet-stream",
        data: part.inlineData.data,
      });
    } else if (typeof part?.text === "string" && part.text.trim()) {
      textOut = textOut ? `${textOut}\n${part.text}` : part.text;
    }
  }

  if (images.length === 0) {
    return {
      artifactPath: null,
      text: textOut,
      message: "Image generation failed: upstream did not return an image",
    };
  }

  // Upload only the first full‑resolution image and return its artifactPath.
  // NOTE: We intentionally do NOT upload a separate thumbnail file to Acontext Disk anymore.
  const img = images[0];
  const buf = Buffer.from(img.data, "base64");
  const ext = extFromMimeType(img.mimeType);
  const filename = `${prefix}/image_${Date.now()}_${randId()}_1.${ext}`;
  const artifactPath = await uploadFileToAcontext(filename, buf, img.mimeType, diskId);

  // Get public URL immediately after upload by calling disks.artifacts.get with withPublicUrl: true
  let publicUrl: string | null = null;
  if (artifactPath) {
    try {
      const acontext = getAcontextClient();
      if (acontext) {
        // Determine target diskId (same logic as uploadFileToAcontext)
        let targetDiskId = diskId;
        if (!targetDiskId) {
          const disks = await acontext.disks.list();
          if (disks && disks.items && disks.items.length > 0) {
            targetDiskId = disks.items[0].id;
          } else {
            const newDisk = await acontext.disks.create();
            targetDiskId = newDisk.id;
          }
        }

        // Parse artifactPath to extract filePath and filename
        // artifactPath format: "generated/2026-01-14/image_xxx.png" (no leading slash)
        // After upload, artifact.path is "/generated/2026-01-15/" and artifact.filename is "image_xxx.png"
        // So artifactPath returned is "generated/2026-01-15/image_xxx.png"
        const pathParts = artifactPath.split('/').filter(part => part.length > 0);
        if (pathParts.length > 0) {
          const filenameOnly = pathParts[pathParts.length - 1];
          // filePath should end with / and start with /
          const filePathDir = pathParts.length > 1 
            ? '/' + pathParts.slice(0, -1).join('/') + '/'
            : '/';

          console.log("[image-generate] Getting publicUrl", {
            artifactPath,
            filePath: filePathDir,
            filename: filenameOnly,
            targetDiskId,
          });

          // Call disks.artifacts.get to get presigned URL
          const result = await acontext.disks.artifacts.get(targetDiskId, {
            filePath: filePathDir,
            filename: filenameOnly,
            withPublicUrl: true,
            withContent: false, // We don't need content, just the URL
          });

          if (result?.public_url) {
            publicUrl = result.public_url;
            console.log("[image-generate] Successfully obtained public URL", {
              artifactPath,
              publicUrl: publicUrl.substring(0, 100) + "...",
            });
          } else {
            console.warn("[image-generate] disks.artifacts.get returned no public_url", {
              artifactPath,
              result,
            });
          }
        }
      }
    } catch (e) {
      console.warn("[image-generate] Failed to get publicUrl via disks.artifacts.get", {
        artifactPath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Frontend can generate its own in‑memory thumbnail/preview from artifactPath if needed.
  return {
    artifactPath: artifactPath ?? null,
    thumbnailPath: null,
    publicUrl,
    text: textOut,
    message: artifactPath
      ? "Image generated successfully"
      : "Image generation failed: image generated but artifact upload failed",
  };
}


