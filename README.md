<div align="center">
  <h1 align="center">Acontext PPT Girl Slide Generator</h1>
  <p align="center">
    <strong>A PPT-style slide generator experience built on the Acontext Agent Playground template</strong>
  </p>
  <p align="center">
    Powered by <a href="https://acontext.io"><strong>Acontext</strong></a>
  </p>
  
  <p align="center">
    <a href="#features"><strong>Features</strong></a> ·
    <a href="#getting-started"><strong>Getting Started</strong></a> ·
    <a href="#deployment"><strong>Deployment</strong></a> ·
    <a href="#documentation"><strong>Documentation</strong></a>
  </p>
  
  <p align="center">
    <img src="https://img.shields.io/badge/Next.js-15+-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
    <a href="https://acontext.io"><img src="https://assets.memodb.io/Acontext/badge-made-with-acontext.svg" alt="Made with Acontext" /></a>
  </p>
</div>

<br/>

**Acontext PPT Girl Slide Generator** is a specialized experience built on top of the **ACONTEXT Agent Playground** starter template, powered by [Acontext](https://acontext.io). This branch focuses on a PPT-style slide generator guided by an anime nurse assistant ("PPT Girl"), while still keeping all the original authentication, chat interface, tool integration, and session management features from the base template.

## 🚀 What is This?

This is a **PPT slide generator demo** that inherits the powerful capabilities of the **Acontext platform** and the underlying Agent Playground template, including:

- **Session Management**: Persistent conversation sessions with automatic context management
- **Semantic Search**: Intelligent retrieval of relevant conversation history
- **File & Artifact Management**: Upload, store, and manage files through Acontext Disk
- **Experience Learning**: Search and reuse learned skills from user Spaces
- **Context Compression**: Automatic token management and context optimization
- **Tool Integration**: Extensible tool system for custom functionality

## ✨ Features

### Core Capabilities

- **🔐 Authentication**: Email/password authentication with Supabase
- **💬 Chat Interface**: Full-featured chat UI with message history, streaming responses, and tool call visualization
- **🎨 Customizable UI**: Built with Tailwind CSS and shadcn/ui components - fully customizable
- **🤖 Avatar Support**: Easy to customize agent avatar and branding
- **🛠️ Extensible Tools**: Add your own custom tools or modify existing ones
- **📁 File Upload**: Support for uploading PDFs, images, and documents
- **🌐 Browser Automation**: Integrated Browser Use SDK for web automation tasks
- **🌓 Theme Support**: Dark/light mode with next-themes

### Acontext Integration

- **Session Persistence**: Each chat session maps to an Acontext Session
- **Semantic Context Search**: Automatically retrieves relevant historical context before generating responses
- **Disk Storage**: Files are stored in Acontext Disk with automatic tool access
- **Experience Search**: Leverages learned skills from user Spaces to improve responses
- **Context Compression**: Automatic token management with manual compression option

## 🛠️ Tech Stack

- **Framework**: Next.js 15+ (App Router)
- **Authentication & Database**: Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- **AI Platform**: Acontext (`@acontext/acontext`)
- **LLM**: OpenAI (`openai` SDK) - compatible with OpenAI API
- **Browser Agent**: Browser Use SDK (`browser-use-sdk`)
- **UI Components**: Tailwind CSS, shadcn/ui, Lucide icons
- **Language**: TypeScript
- **Theming**: next-themes

## 📦 Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- A Supabase account ([create one here](https://database.new))
- An Acontext account ([sign up here](https://acontext.io))
- An OpenAI API key (or compatible API endpoint)

### Installation

1. **Clone the repository**

```bash
git clone <your-repo-url> nextjs-with-supabase-acontext
cd nextjs-with-supabase-acontext
```

2. **Install dependencies**

```bash
npm install
# or
yarn install
# or
pnpm install
```

3. **Set up Supabase**

   - Create a new project at [Supabase Dashboard](https://database.new)
   - Note your `Project URL` and `Anon (publishable) key`

4. **Configure environment variables**

   Create a `.env.local` file in the root directory:

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-or-anon-key

# Acontext (required for full functionality)
ACONTEXT_API_KEY=your-acontext-api-key
ACONTEXT_BASE_URL=https://api.acontext.com/api/v1  # Optional, defaults to this

# OpenAI LLM (required)
OPENAI_LLM_ENDPOINT=https://api.openai.com/v1
OPENAI_LLM_API_KEY=your-openai-api-key
OPENAI_LLM_MODEL=gpt-4o-mini  # or gpt-3.5-turbo, gpt-4, etc.
OPENAI_LLM_TEMPERATURE=0.7
OPENAI_LLM_MAX_TOKENS=2000

# Browser Use Cloud (optional, for browser automation)
BROWSER_USE_API_KEY=your-browser-use-cloud-api-key
```

5. **Set up database schema**

   - Open your Supabase project
   - Go to **SQL Editor**
   - Run the SQL from `specs/001-chatbot-openai/schema.sql`
   - This creates tables for `chat_sessions` and `chat_messages`
   - For Acontext integration, also run `specs/001-chatbot-openai/migration-acontext.sql`

6. **Run the development server**

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Visit `http://localhost:3000` to see your application.

## 🎨 Customization Guide

### Customizing the UI

The UI is built with **Tailwind CSS** and **shadcn/ui** components, making it easy to customize:

1. **Theme Colors**: Edit `tailwind.config.ts` to change color schemes
2. **Components**: All UI components are in `components/ui/` - modify as needed
3. **Layout**: Main pages are in `app/` directory
4. **Homepage**: Customize `app/page.tsx` for your landing page
5. **Chat Interface**: Modify `components/chatbot-panel.tsx` for chat UI changes

### Customizing the Avatar

The agent avatar can be customized in several ways. In this PPT Girl branch, a nurse-style anime character is already wired up as the default avatar.

1. **Character Image**: Replace the image at `/public/fonts/ppt girl.png` with your own character/logo (keep the same filename to avoid code changes), or update `components/parallax-character.tsx` to point to a different path
2. **Homepage Avatar**: The homepage hero section uses the parallax character component to display `ppt girl.png` floating beside the copy
3. **Chat Avatar**: Modify the avatar display in `components/chatbot-panel.tsx` if you also want PPT Girl (or another character) in the chat UI

Example locations:
- `components/parallax-character.tsx` - Homepage parallax character (uses `/fonts/ppt girl.png`)
- `public/fonts/ppt girl.png` - PPT Girl character asset used on the homepage
- `public/fonts/ppt_girl_chatbot.png` - Optional PPT Girl asset for chatbot avatar
- `app/page.tsx` - Homepage layout and PPT Girl landing copy

### Adding Custom Tools

Tools are defined as OpenAI function calling schemas. To add your own tool:

1. **Create a tool file** in `lib/` (e.g., `lib/my-custom-tool.ts`):

```typescript
export function getMyToolSchema() {
  return {
    type: "function" as const,
    function: {
      name: "my_custom_tool",
      description: "Description of what your tool does",
      parameters: {
        type: "object",
        properties: {
          param1: {
            type: "string",
            description: "Parameter description",
          },
        },
        required: ["param1"],
      },
    },
  };
}

export async function executeMyTool(args: { param1: string }) {
  // Your tool logic here
  return {
    result: "Tool execution result",
  };
}
```

2. **Register the tool** in `lib/openai-client.ts`:

```typescript
// Add to getAvailableTools function
if (shouldIncludeMyTool) {
  tools.push(getMyToolSchema());
}

// Add to executeToolCall function
if (name === "my_custom_tool") {
  const args = JSON.parse(argsJson || "{}");
  return await executeMyTool(args);
}
```

3. **Wire it into the chat API** in `app/api/chatbot/route.ts`:

```typescript
// The tools are automatically included when calling chatCompletionStream
```

**Existing Tool Examples:**
- `lib/browser-use.ts` - Browser automation
- `lib/acontext-disk-tools.ts` - File system operations
- `lib/acontext-experience-search-tool.ts` - Experience search
- `lib/acontext-todo-tool.ts` - Todo management

### Customizing Acontext Integration

The Acontext integration is modular and can be customized:

- **Session Management**: `lib/acontext-integration.ts` - Modify session creation and management
- **Client Configuration**: `lib/acontext-client.ts` - Adjust Acontext client settings
- **Tool Integration**: `lib/acontext-disk-tools.ts` - Customize disk tool behavior
- **Experience Search**: `lib/acontext-experience-search-tool.ts` - Modify search logic

## 📚 Project Structure

```
nextjs-with-supabase-acontext/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── acontext/      # Acontext API endpoints
│   │   ├── chatbot/       # Chat API endpoint
│   │   └── tools/         # Tools API endpoint
│   ├── auth/              # Authentication pages
│   ├── protected/         # Protected chat page
│   └── page.tsx           # Homepage
├── components/             # React components
│   ├── ui/                # shadcn/ui components
│   ├── chatbot-panel.tsx  # Main chat interface
│   └── parallax-character.tsx  # Homepage character
├── lib/                   # Core libraries
│   ├── acontext-*.ts      # Acontext integration
│   ├── openai-client.ts   # OpenAI client wrapper
│   ├── browser-use.ts    # Browser automation
│   └── supabase/          # Supabase utilities
├── specs/                 # Project specifications
└── types/                 # TypeScript types
```

## 🔧 Available Tools

### Built-in Tools

1. **Browser Use Task** (`browser_use_task`)
   - Performs web automation tasks
   - Requires Browser Use Cloud API key
   - Location: `lib/browser-use.ts`

2. **Acontext Disk Tools**
   - `write_file`, `read_file`, `replace_string`, `list_artifacts`, `download_file`
   - File system operations on Acontext Disk
   - Location: `lib/acontext-disk-tools.ts`

3. **Experience Search** (`experience_search`)
   - Searches user's learned skills from Acontext Space
   - Location: `lib/acontext-experience-search-tool.ts`

4. **Todo Management** (`todo`)
   - Create and manage todos within chat sessions
   - Location: `lib/acontext-todo-tool.ts`

### Adding Your Own Tools

See the [Customization Guide](#adding-custom-tools) section above.

## 🌐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key | Yes |
| `ACONTEXT_API_KEY` | Acontext API key | Yes (for full features) |
| `ACONTEXT_BASE_URL` | Acontext API base URL | No (has default) |
| `OPENAI_LLM_ENDPOINT` | OpenAI-compatible API endpoint | Yes |
| `OPENAI_LLM_API_KEY` | OpenAI API key | Yes |
| `OPENAI_LLM_MODEL` | Model name (e.g., `gpt-4o-mini`) | Yes |
| `OPENAI_LLM_TEMPERATURE` | Temperature (0-2) | No (default: 0.7) |
| `OPENAI_LLM_MAX_TOKENS` | Max tokens in response | No (default: 2000) |
| `BROWSER_USE_API_KEY` | Browser Use Cloud API key | No (optional) |
| `IMAGE_GEN_API_KEY` | Upstream image generation API key (sent as `x-goog-api-key`) | No (optional, required for image_generate) |
| `IMAGE_GEN_BASE_URL` | Upstream image generation base URL | No (default: `https://api.openai-next.com`) |
| `IMAGE_GEN_DEFAULT_MODEL` | Image generation model name (server-controlled; not overridable by tool args) | No (default: `gemini-3-pro-image-preview`) |

## 🚢 Deployment

### Deploy to Vercel

Vercel deployment will guide you through creating a Supabase account and project.

After installation of the Supabase integration, all relevant environment variables will be assigned to the project so the deployment is fully functioning.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmbt1909432%2FAcontext-Agent-Playground&project-name=acontext-agent-playground&repository-name=acontext-agent-playground&demo-title=ACONTEXT%20Agent%20Playground&demo-description=A%20production-ready%20starter%20template%20for%20building%20context-aware%2C%20autonomous%20AI%20agents%20powered%20by%20Acontext.&demo-url=https%3A%2F%2Fgithub.com%2Fmbt1909432%2FAcontext-Agent-Playground)

The above will also clone the Starter kit to your GitHub, you can clone that locally and develop locally.

#### Vercel Configuration Explained

When deploying to Vercel, you have two options:

**Option 1: One-Click Deploy (Recommended for First-Time Setup)**

1. Click the "Deploy with Vercel" button above
2. Vercel will prompt you to:
   - Sign in to Vercel (or create an account)
   - Connect your GitHub account (if not already connected)
   - Create a new Supabase project (or connect existing one)
3. During the Supabase integration setup:
   - Vercel will automatically create a Supabase project for you
   - All required Supabase environment variables will be automatically configured:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. You'll need to manually add the remaining environment variables in Vercel dashboard:
   - `ACONTEXT_API_KEY` - Your Acontext API key
   - `OPENAI_LLM_ENDPOINT` - OpenAI API endpoint (default: `https://api.openai.com/v1`)
   - `OPENAI_LLM_API_KEY` - Your OpenAI API key
   - `OPENAI_LLM_MODEL` - Model name (e.g., `gpt-4o-mini`)
   - `OPENAI_LLM_TEMPERATURE` - Temperature (default: `0.7`)
   - `OPENAI_LLM_MAX_TOKENS` - Max tokens (default: `2000`)
   - `BROWSER_USE_API_KEY` - Optional, for browser automation
   - `ACONTEXT_BASE_URL` - Optional, defaults to `https://api.acontext.com/api/v1`
5. After deployment, run the database migrations:
   - Go to your Supabase project dashboard
   - Navigate to SQL Editor
   - Run the SQL from `specs/001-chatbot-openai/schema.sql`
   - Run the SQL from `specs/001-chatbot-openai/migration-acontext.sql`

**Option 2: Manual Deployment (If You Already Have a GitHub Repository)**

1. Push your code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "Add New Project"
4. Import your GitHub repository
5. Configure environment variables:
   - **Supabase Integration**: Click "Add Integration" → Search "Supabase" → Connect your Supabase project
     - This automatically sets `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - **Manual Variables**: Add the remaining environment variables listed above
6. Click "Deploy"
7. After deployment, run the database migrations in Supabase SQL Editor

#### Environment Variables in Vercel

To add environment variables in Vercel:

1. Go to your project in Vercel Dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each variable with its value
4. Select which environments to apply to (Production, Preview, Development)
5. Click "Save"
6. Redeploy your application for changes to take effect

**Important Notes:**
- Environment variables starting with `NEXT_PUBLIC_` are exposed to the browser
- Keep sensitive keys (like `OPENAI_LLM_API_KEY`, `ACONTEXT_API_KEY`) secure and never commit them
- Vercel automatically provides `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` when you use the Supabase integration

#### Local Development After Vercel Deployment

If you wish to just develop locally and not deploy to Vercel, follow the steps below:

1. Clone the repository from GitHub (created during Vercel deployment)
2. Install dependencies: `npm install`
3. Create `.env.local` file with all environment variables (see [Installation](#installation) section)
4. Run database migrations in Supabase SQL Editor
5. Start development server: `npm run dev`

### Other Platforms

This is a standard Next.js application and can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- Render
- AWS Amplify
- Self-hosted with Node.js

## 🔌 Acontext Integration Details

### Implemented Features

#### 1. Session Persistence ✅
- Each chat session maps to an Acontext Session (reused, not recreated each time)
- Database schema includes `acontext_session_id` field
- Sessions automatically create or reuse Acontext sessions
- All messages are stored in the same Acontext session

#### 2. Semantic Search ✅
- Retrieves relevant historical context from Acontext before generating responses
- Searches Acontext session for relevant historical messages before calling LLM
- Injects search results into system prompt to enhance context coherence
- Enabled by default, can be disabled with `enableSemanticSearch: false`

#### 3. File Upload & Artifacts ✅
- Support for uploading files (PDFs, images, documents) for AI analysis
- Chat interface includes file upload button (📎 icon)
- Supports multiple file uploads
- Files are uploaded to Acontext Disk via Artifacts API
- Uploaded files are referenced in messages, AI can read file content
- **Image Support**: Uses OpenAI Vision API, AI can directly view and analyze images
- **File List View**: View all files stored in Acontext Disk

#### 4. File System Tools (Function Calling) ✅
- LLM can autonomously read/write files on Acontext Disk through tool functions
- Includes official `DISK_TOOLS` exposed via OpenAI Tool Schema: `write_file`, `read_file`, `replace_string`, `list_artifacts`, `download_file`
- Chat API automatically provides these tools when Acontext is configured
- Tools automatically select existing disk (or create one if needed), no frontend intervention required

### File Upload Usage

#### Frontend (Chat Interface)

1. **Click attachment button**: 📎 (paperclip) icon button next to input box
2. **Select files**: Opens file picker, supports multiple files
3. **View preview**: Selected files appear above input box with filename
4. **Remove attachment**: Click ❌ button next to file to remove
5. **Send message**: Enter message and send, files upload with message
6. **View file list**: Click "Files" button to view all files in Acontext Disk

#### API Usage

Send a message with attachments:

```typescript
const response = await fetch("/api/chatbot", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message: "Analyze this document",
    sessionId: "your-session-id",
    attachments: [
      {
        filename: "document.pdf",
        content: "base64-encoded-content", // base64 encoded file content
        mimeType: "application/pdf",
      },
      {
        filename: "image.png",
        content: "base64-encoded-image",
        mimeType: "image/png",
      },
    ],
    enableSemanticSearch: true, // optional, default true
  }),
});
```

**Attachment Format:**
- `filename` (string): File name
- `content` (string): Base64 encoded file content (without `data:image/png;base64,` prefix)
- `mimeType` (string): MIME type, e.g., `application/pdf`, `image/png`, `text/plain`

#### View File List

```typescript
// List all artifacts
const response = await fetch("/api/acontext/artifacts");
const data = await response.json();

if (data.success) {
  console.log(`Found ${data.count} files:`, data.artifacts);
}

// List files from specific disk
const response = await fetch("/api/acontext/artifacts?diskId=your-disk-id");
```

### Database Migration

Run the following SQL to add Acontext-related fields:

```sql
-- Run in Supabase SQL Editor
-- File location: specs/001-chatbot-openai/migration-acontext.sql
```

### Environment Variables

Ensure Acontext is configured in `.env.local`:

```env
ACONTEXT_API_KEY=your_api_key_here
ACONTEXT_BASE_URL=https://api.acontext.com/api/v1  # Optional, defaults to this

# Bypass proxy for Acontext API (local development only)
# When set to true or 1, Acontext API requests bypass HTTP_PROXY/HTTPS_PROXY
# Other service requests still use proxy
ACONTEXT_BYPASS_PROXY=true  # Optional, only needed for local development
```

### Implementation Details

**Key Files:**
- `lib/acontext-integration.ts` - Acontext integration utility functions
- `lib/acontext-disk-tools.ts` - Acontext disk file system tools (Function Calling)
- `app/api/chatbot/route.ts` - Updated chat API with Acontext integration
- `components/chatbot-panel.tsx` - File upload UI
- `types/chat.ts` - Updated type definitions

**Key Functions:**
- `getOrCreateAcontextSession()` - Get or create Acontext session
- `searchRelevantContext()` - Semantic search for relevant context
- `uploadFileToAcontext()` - Upload file to Acontext
- `storeMessageInAcontext()` - Store message in Acontext

**Notes:**
- **Optional Integration**: If `ACONTEXT_API_KEY` is not configured, all Acontext features automatically skip, basic chat functionality remains unaffected
- **Error Handling**: All Acontext operations have error handling, failures don't affect main flow
- **Performance**: Semantic search retrieves recent messages as context, production may need more refined search strategy

## 📖 Documentation

- [Acontext Documentation](https://docs.acontext.io)
- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com)

## 🤝 Contributing

This is a starter template - feel free to fork and customize it for your needs!

## 📄 License

Check the LICENSE file in the repository.

## 🆘 Support

- **Acontext**: [Documentation](https://docs.acontext.io) | [Support](https://acontext.io)
- **Issues**: Open an issue in the repository

---

**Built with ❤️ using Acontext Platform**
