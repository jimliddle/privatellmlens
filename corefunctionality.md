### Core Functionality

---

#### Chat Interface

- **Single-file application** — entire app is one `.html` file with no application backend required.
- **Mobile support** — works on Android with Ollama or llama.cpp via Termux, and supports browser-hosted/local-network use on other mobile devices.
- Text input with Send button and Enter key to submit prompts.
- **Streaming responses** — assistant replies stream token-by-token in real time.
- Displays a spinner with elapsed time while waiting for a response.
- Shows total response time after each reply completes.
- **Markdown rendering** via marked.js — headings, bold, italic, lists, tables, code blocks all formatted correctly.
- **Syntax-highlighted code blocks** via highlight.js with a one-click copy button per block.
- **Light / Dark / System theme** — switchable from Settings, persists across sessions.
- Configurable conversation history and model context.
- Word/token count display in the input area.
- Connection status indicator with auto-refresh every 30 seconds.

---

#### File Attachments and Document Workspaces

- Supports text, images, PDF, DOCX, PPTX, Python, HTML, CSV and JSON files.
- Previews attachments before sending with cancel option.
- Ordinary document attachments are extracted locally, chunked with overlap, encrypted and persisted as a reusable per-thread document workspace.
- Multiple documents can remain attached to a thread without being re-read or re-extracted for each question.
- SHA-256 content hashing prevents duplicate document storage within the same thread.
- Branching a conversation copies and re-encrypts the document workspace for the new thread.
- **Automatic document strategy** — sends documents directly when they fit the context; oversized targeted questions use hybrid retrieval; oversized whole-document questions use question-directed map analysis.
- **Exact / targeted strategy** — retrieves the most relevant passages for oversized workspaces.
- **Whole-document analysis** — evaluates document sections against the user's question before final synthesis.
- **Hybrid local retrieval** — combines BM25 lexical ranking with local semantic embeddings from `Xenova/all-MiniLM-L6-v2`.
- Semantic embeddings run in a dedicated WASM worker so retrieval does not require an external embedding service and does not compete with an active WebGPU chat model for GPU memory.
- The embedding model is q8 and requires roughly 25 MB of model/tokenizer/config assets on first semantic use; browser caching reuses them afterward.
- Semantic indexing is lazy — embeddings are created only when an oversized targeted query needs retrieval, not merely when a document is attached.
- Normalised chunk embeddings are compactly quantised to signed 8-bit values and stored inside the existing encrypted document payload.
- BM25 and semantic rankings are combined using reciprocal-rank fusion.
- A lightweight MMR-style diversification pass reduces redundant adjacent/near-duplicate passages in the final context.
- If the worker, WebAssembly runtime, embedding model or semantic inference is unavailable, document retrieval automatically falls back to local BM25.
- Retrieved passages preserve page, slide or line provenance and can be opened in an exact source-passage viewer.
- **Images** — converted to Base64 and sent to compatible local vision models.
- **Long Context mode** — explicitly sends full files to Gemini Flash. Requires a Gemini API key and remains separate from the private local document workspace.
- Output is sanitised using DOMPurify.

---

#### Thread Management

- **IndexedDB persistence** — threads and messages survive page reloads and browser restarts.
- Create and delete multiple conversation threads.
- Sidebar listing all threads, highlighting the active one.
- Switch between threads, loading the corresponding message history and document workspace.
- Auto-creates a default thread on first run.
- **Auto-title** — derives a concise thread title after the first exchange (can be disabled in Settings).
- **Thread search** — search stored messages across threads.
- **Conversation branching** — create a new thread forked from any message point, copying messages and the encrypted document workspace.
- Per-thread model parameters (temperature, top-p, repeat penalty) are saved in IndexedDB.

---

#### Message Actions

All actions appear at the top-right of messages, with a second action row on long messages.

- **Copy** — copies raw message text to clipboard with a brief confirmation.
- **Edit** (user messages) — restores the prompt to the input field and removes that message plus subsequent messages for resubmission.
- **Regenerate** (assistant messages) — removes the response and subsequent messages and re-runs the prompt.
- **Branch** — forks the conversation into a new thread from that message point.
- **Delete** — removes the individual message.

---

#### Model Selection

- Fetches available Ollama models from `/api/tags` and llama.cpp models from `/v1/models`.
- Saves the last selected model in localStorage.
- **Model parameter controls** — temperature, top-p and repeat penalty, saved per thread.
- Explicit model-context profiles for Ollama; llama.cpp GPU context follows the active server profile.
- Custom Ollama endpoint configurable in Settings.
- Optional in-browser Qwen3.5 WebGPU models.
- **Perplexity AI** — routes the prompt to Perplexity's API instead of the local LLM. API key required.
- **OpenAI image generation** — generates images through the OpenAI image API. API key required.

---

#### Agentic Features

- **Auto-title threads** — names the thread after the first exchange.
- **Auto-search (Tavily)** — a conservative local router decides whether fresh public-web information is required before performing a Tavily search.
- **Auto-summarise context** — summarises older messages when the conversation exceeds the configured history window.
- **Deep Web Research** — structured multi-step Tavily search/answer loop with up to three distinct searches.
- **Proactive clarification** — asks one focused clarification question when enabled and genuinely needed.
- **Suggested follow-ups** — generates contextual follow-up suggestions.
- **Auto-extract memories** — extracts durable facts during idle time when enabled.
- **Auto fact-check** — can verify factual claims through Tavily when enabled.

---

#### Memory System

- Memories are encrypted at rest in IndexedDB.
- **Use Memories** controls whether relevant facts are injected into future prompts.
- **Learn Memories** controls idle-time local extraction of durable facts from conversations.
- Memory selection is relevance- and budget-aware.
- Exact duplicates are ignored and newer conflicting facts can supersede older ones.
- Instruction-like content and likely secrets are rejected.
- Memory review UI supports manual addition, editing and deletion.

---

#### Voice Input

- Voice-to-text via the Web Speech API where supported.
- Microphone button inserts recognised speech into the text field.

---

#### Settings

- **Appearance** — light / dark / system theme and Automatic / Compact / Desktop layout modes.
- **Processing** — text chunk size, PDF pages per chunk, conversation history and model context.
- **Ollama Endpoint** — override the default `localhost:11434`.
- **API Keys** — Perplexity, OpenAI, Tavily and Gemini keys are stored through the encrypted WebCrypto vault.
- **Agentic Functions** — controls for auto-search, title generation, context summarisation, memory use/learning, follow-ups and fact-checking.
- **WebGPU Models** — optional Qwen3.5 browser models with browser-cached downloads.

---

#### Data Storage

- **IndexedDB version 6** contains:
  - `messages` — conversation messages and response metadata.
  - `threads` — thread metadata, system prompt and per-thread model parameters.
  - `memories` — encrypted memory records and metadata.
  - `vault` — non-extractable WebCrypto master key and encrypted provider secrets.
  - `documents` — encrypted per-thread document workspaces, including extracted text, chunks and cached semantic indexes.
- **Document encryption** — AES-256-GCM with additional authenticated data binding each encrypted document payload to its thread and crypto ID.
- **Semantic index privacy** — MiniLM chunk vectors are cached only inside the encrypted document payload; no plaintext vector store or external embedding API is used.
- **localStorage** — non-sensitive preferences and feature settings.
- Reset IndexedDB button is available in Settings.
- Clear-all-messages and clear-all-memories controls are available without developer tools.

---

#### Export

- **JSON backup** — exports threads, messages and portable settings; API keys, encrypted memories and document workspaces are intentionally excluded.
- **PDF export** — exports the current conversation to a formatted PDF through the browser print flow.

---

#### Error Handling

- Retry logic for model fetching from Ollama.
- Connection status with automatic polling.
- Graceful errors for API failures, missing keys and file-read errors.
- Foreground model and document-processing work can be cancelled.
- Hybrid document retrieval fails open to BM25 if local semantic embedding cannot be used.
