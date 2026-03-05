### Core Functionality

---

#### Chat Interface

- **Single-file application** — entire app is one `.html` file with no dependencies to install. Works by double-clicking the file directly (no web server required for local Ollama).
- **Mobile support** — works on Android with Ollama installed via Termux. On iPhone, works as a remote UI connecting to Ollama running on another machine on the same network.
- Text input with Send button and Enter key to submit prompts.
- **Streaming responses** — assistant replies stream token-by-token in real time.
- Displays a spinner with elapsed time while waiting for a response.
- Shows total response time after each reply completes.
- **Markdown rendering** via marked.js — headings, bold, italic, lists, tables, code blocks all formatted correctly.
- **Syntax-highlighted code blocks** via highlight.js with a one-click copy button per block.
- **Light / Dark / System theme** — switchable from Settings, persists across sessions.
- Configurable context window — controls how many previous messages are included with each request.
- Word/token count display in the input area.
- Connection status indicator (connected/disconnected dot) with auto-refresh every 30 seconds.

---

#### File Attachments

- Supports text, images, PDFs, Python, HTML, CSV, and JSON files.
- Previews attachments before sending with cancel option.
- **Text/code files** — content read and included in the prompt, chunked by configurable byte size with each chunk summarised by the LLM.
- **Don't Summarize** checkbox — sends raw file content without chunking/summarisation (slower but more precise).
- **Images** — converted to Base64 and sent as vision input. Prompt defaults to text extraction but can be overridden.
- **PDFs** — text extracted from all pages via pdf.js and included in the prompt.
- **Long Context mode** — sends entire file to Gemini Flash in a single prompt for large documents that exceed local context limits. Supports multiple files in a single send. Requires Gemini API key.
- File names displayed in message history.
- Output sanitised using DOMPurify.

---

#### Thread Management

- **IndexedDB persistence** (v4) — all threads, messages, and memories survive page reloads and browser restarts.
- Create and delete multiple conversation threads.
- Sidebar listing all threads, highlighting the active one.
- Switch between threads, loading the corresponding message history.
- Auto-creates a "Default" thread on first run.
- **Auto-title** — LLM automatically names the thread after the first exchange (can be disabled in Settings).
- **Thread search** — filter threads by name in the sidebar.
- **Conversation branching** — create a new thread forked from any message point, copying all messages up to that point.
- Per-thread model parameters (temperature, top-p, repeat penalty) saved in IndexedDB.

---

#### Message Actions

All actions appear on hover at both the **top-right and bottom-right** of each message bubble, so they are accessible without scrolling on long responses.

- **Copy** — copies raw message text to clipboard with a brief checkmark confirmation.
- **Edit** (user messages) — restores the prompt to the input field and removes that message plus all subsequent messages, allowing the conversation to be resubmitted with changes.
- **Regenerate** (assistant messages) — removes the response and all subsequent messages and re-runs the prompt.
- **Branch** — forks the conversation into a new thread from that message onwards.
- **Delete** — removes the individual message.

---

#### Model Selection

- Fetches available models from the Ollama API (`/api/tags`) and populates a dropdown.
- Saves the last selected model in localStorage.
- **Model parameter controls** — temperature (0–2), top-p (0–1), and repeat penalty (1–1.5) accessible via a popover button next to the model selector. Parameters are only sent to Ollama when changed from their defaults. Saved per thread. Badge highlights when non-default values are active.
- Custom Ollama endpoint configurable in Settings (e.g. for non-standard port or network host).
- **Perplexity AI** — routes the prompt to Perplexity's API instead of Ollama. API key required.
- **OpenAI image generation** — generates images via DALL-E. API key required.

---

#### Agentic Features (Standard — on by default)

- **Auto-title threads** — LLM generates a concise thread name after the first exchange.
- **Auto-search (Tavily)** — LLM decides whether a web search would improve its answer and executes one automatically (single pass). Tavily API key required. Works best with 4B+ parameter models.
- **Auto-summarise context** — when the conversation exceeds the configured context window, older messages are summarised and compressed automatically to preserve context.

#### Agentic Features (Experimental — off by default)

These features are more resource-intensive and work best with capable models (7B+).

- **Agent loop** — multi-step reasoning with iterative Tavily web searches before synthesising a final answer. Up to 3 iterations.
- **Proactive clarification** — LLM asks a single clarifying question before answering ambiguous prompts. An "Answer now →" button bypasses this if the user just wants a direct response.
- **Suggested follow-ups** — generates 3 contextual follow-up question suggestions after each response.
- **Auto-attachment strategy** — LLM decides the best way to process an attached file before sending.
- **Auto-extract memories** — extracts factual statements from each conversation and stores them as persistent memories for future context injection.

---

#### Memory System

- Automatically extracts facts and preferences from conversations and stores them in IndexedDB.
- Relevant memories are injected into the system prompt context for future conversations.
- **Memory review UI** — accessible from Settings, allows viewing and deleting individual stored memories.

---

#### Voice Input

- Voice-to-text via the Web Speech API (browser-native, no external service).
- Microphone button in the input area; recognised speech is inserted into the text field.

---

#### Settings

- **Appearance** — light / dark / system theme.
- **Processing** — text chunk size (bytes), PDF pages per chunk, context window (number of messages).
- **Ollama Endpoint** — override the default `localhost:11434`. Note: non-localhost endpoints require `OLLAMA_ORIGINS=*` on the target Ollama server when opening the file directly without a web server.
- **API Keys** — each shows a green "Set" badge when a key is stored, and a trash icon on hover to delete individually without opening developer tools:
  - **Perplexity** — routes prompts to Perplexity AI's hosted search-augmented LLM instead of local Ollama.
  - **OpenAI** — enables DALL-E image generation from within the chat.
  - **Tavily** — enables real-time web search. Required for Auto-search, the Agent Loop, and Auto-fact-check features. Tavily is a privacy-focused search API designed for AI use.
  - **Gemini** — enables Long Context mode, which sends large files to Gemini Flash for processing in a single prompt when they exceed local model context limits.
- **Agentic Functions** — toggle switches for all standard and experimental agentic features, with descriptions and tooltips.

---

#### Data Storage

- **IndexedDB** (v4) — three object stores:
  - `messages` — role, text, type, fileName, imageData, responseTime, threadId, timestamp.
  - `threads` — id, name, systemPrompt, created, plus per-thread model parameters (temperature, topP, repeatPenalty).
  - `memories` — id, fact, timestamp.
- **localStorage** — all settings and preferences.
- Retry logic for IndexedDB open failures.
- Reset IndexedDB button in Settings (no developer tools required).
- Clear all messages option per thread.

---

#### Export

- **PDF export** — exports the full current conversation to a formatted PDF directly from the browser.

---

#### Error Handling

- Retry logic (exponential backoff) for model fetching from Ollama.
- Connection status dot with auto-reconnect polling.
- Graceful error messages for API failures, missing keys, and file read errors.
- IndexedDB reset button accessible from the UI without requiring developer tools.
- Processing can be cancelled mid-stream via a Cancel button.
