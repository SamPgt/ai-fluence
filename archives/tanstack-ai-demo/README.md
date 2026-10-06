# TanStack AI Chat Template

A modern, full-stack AI chat application built with TanStack AI TanStack Start, featuring multi-provider AI support, real-time streaming, and a beautiful UI.

## ✨ Features

- 🤖 **Multi-Provider AI** - OpenAI, Anthropic, Google Gemini, xAI (Grok), Ollama (local)
- 💬 **Real-time Streaming** - Natural typing animation for AI responses
- 📚 **Persistent History** - Chat history stored in PostgreSQL
- 🔍 **Full-Text Search** - Search across chats (⌘K / Ctrl+K)
- 📱 **Responsive Design** - Mobile-first with collapsible sidebar
- 🌓 **Dark Mode** - System-aware theme with manual override
- 🐳 **Docker Ready** - Easy deployment with Docker Compose

## 🚀 Tech Stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | TanStack Start, TanStack Router, TanStack Query, React, Tailwind CSS, shadcn/ui |
| **Backend** | TanStack AI, Drizzle ORM, PostgreSQL |
| **Runtime** | Bun (recommended) or Node.js |

### AI Providers & Models

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo |
| **Anthropic** | Claude Sonnet 4.5, Claude 3.5 Sonnet, Claude 3.5 Haiku |
| **Google** | Gemini Pro, Gemini 2.0 Flash |
| **xAI** | Grok 4, Grok 3 |
| **Ollama** | Llama 3 (+ any local model) |

> See [TanStack AI docs](https://tanstack.com/ai) for more details.

## 📋 Prerequisites

- **Bun** 1.0+ or **Node.js** 18+
- **PostgreSQL** 14+ (or use Docker)
- At least one AI provider API key:
  - [OpenAI](https://platform.openai.com/api-keys) | [Anthropic](https://console.anthropic.com/) | [Google AI](https://aistudio.google.com/app/apikey)

---

## 🛠️ Quick Start

### Option 1: Local Development (Bun)

```bash
git clone https://github.com/rs-4/tanstack-ai-demo.git
cd tanstack-ai-demo
bun install
cp .env.example .env.local
# Edit .env.local with your DB and API keys
bun run db:push
bun run dev
```

### Option 2: Local Development (npm)

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run dev
```

### Option 3: Docker (Production)

```bash
cp .env.example .env.local
# Edit .env.local with your API keys (DATABASE_URL is auto-configured)
docker-compose up -d --build
```

Visit [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/chatapp

# AI Provider API Keys (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
XAI_API_KEY=xai-...

# Ollama (optional)
OLLAMA_BASE_URL=http://localhost:11434

# Server (optional)
PORT=3000
```

---

## 🦙 Using Ollama (Local AI)

Run AI models locally without API keys:

```bash
# Install (macOS)
brew install ollama

# Install (Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull and run a model
ollama pull llama3
ollama serve
```

Then select **"Ollama (Local)"** in the model selector.

> See [TanStack AI Ollama docs](https://tanstack.com/ai/latest/docs/adapters/ollama) for more details.

---

## 📁 Project Structure

```
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── chat/            # Chat components
│   └── ...
├── db/                  # Database (Drizzle schema)
├── lib/                 # Server functions & utilities
├── routes/              # TanStack Router routes
└── types/               # TypeScript types
```

---

## 🔧 Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server |
| `bun run build` | Build for production |
| `bun run db:push` | Push schema to database |
| `bun run db:studio` | Open Drizzle Studio |
| `docker-compose up -d` | Start with Docker |

> Replace `bun` with `npm` if using Node.js.

---

## 🎨 Customization

### Add AI Providers

Edit `src/lib/store.ts` and `src/lib/chat-actions.ts`.

### Styling

- **Theme colors**: `src/styles.css`
- **Components**: `src/components/ui/`
- **Fonts**: `src/routes/__root.tsx`

---

## 📝 License

MIT License - see [LICENSE](LICENSE)

## 🔗 Links

- [GitHub](https://github.com/rs-4/tanstack-ai-demo) | [TanStack](https://tanstack.com) | [TanStack AI](https://tanstack.com/ai)
