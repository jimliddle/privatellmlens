# PrivateLLMLens

PrivateLLMLens is a single-file browser interface for local Ollama, llama.cpp and optional in-browser WebGPU models. It works on desktop and Android/Termux without an application backend.

Try the hosted version: **https://jimliddle.github.io/privatellmlens/**

Alternatively, download `index.html`. Serve it from `localhost`, `127.0.0.1`, or HTTPS for PWA installation and consistent browser storage.

## Highlights

- Streaming Ollama and OpenAI-compatible llama.cpp chat
- Multiple IndexedDB-backed conversation threads with editable system prompts
- Encrypted persistent document workspaces for PDF, PPTX, text, CSV, HTML, Python and JSON
- Direct-context, lexical retrieval and question-directed whole-document analysis
- Multiple documents per thread, reusable without reattaching or re-extracting
- Page, slide and line-level citations with an exact source-passage viewer
- Ollama vision-model image attachments
- Explicit 8K, 16K and 32K context profiles; 4K utility calls
- Active request and document-processing cancellation
- Encrypted persistent memories with separate use and learning controls
- Optional Tavily search, Deep Web Research, Perplexity, OpenAI image generation and explicit Gemini long-context processing
- Optional native Adreno GPU acceleration through llama.cpp/OpenCL on supported Android devices
- Optional in-browser Qwen3.5 0.8B and 2B WebGPU models
- Markdown, syntax highlighting, regeneration, branching, search, JSON backup and PDF export
- Embedded PWA manifest and icon

## Single-file design

The interface, styles, application logic, PWA manifest and icon live in `index.html`. Local inference requests go directly from the browser to Ollama or llama.cpp. Optional cloud calls go directly to the selected provider only when enabled.

Browser dependencies are loaded from CDNs: PDF.js, JSZip (PPTX), Marked, DOMPurify, Highlight.js, Font Awesome, fonts, and the optional WebGPU runtime. The first PPTX use therefore needs JSZip to have loaded; normal browser caching can reuse it afterward.

## Quick start with Ollama

1. Start Ollama and install a model:

   ```sh
   ollama pull qwen3:4b
   ollama serve
   ```

2. Open the hosted application or serve the downloaded file.
3. Confirm the header reports **Ollama connected**.
4. Select a model and start chatting.

PrivateLLMLens discovers Ollama models through `/api/tags` and sends chat to `/api/chat`. It separately discovers a llama.cpp server through `/v1/models` on port 8080 and translates OpenAI-compatible streaming into the same internal format.

## Document workspaces

Ordinary document attachments are extracted once, encrypted with AES-256-GCM, stored in IndexedDB, and associated with the current thread. A SHA-256 content hash prevents duplicate storage. Branching a conversation copies and re-encrypts its document workspace for the new thread.

Three strategies are available:

- **Automatic** sends documents in full when they fit the selected context. Oversized targeted questions use lexical retrieval; oversized whole-document requests use question-directed map analysis.
- **Exact / targeted** retrieves the most relevant source passages when the workspace is too large.
- **Whole-document analysis** examines all document sections against the question before synthesis.

Context budgeting reserves room for the system prompt, memories, conversation and answer. Retrieved passages retain provenance. Citations open the exact decrypted page, slide or line range locally.

Supported local workspace formats:

- PDF, with page references
- PPTX, including slide text, tables, speaker notes and available image descriptions
- Text, CSV, HTML, Python and JSON, with line references

Legacy binary `.ppt` is not parsed in-browser; convert it to `.pptx` or PDF. PPTX extraction does not visually interpret undescribed images, diagrams or chart graphics.

Attachments are explicitly marked as untrusted data so their contents cannot override application instructions. Gemini Long Context remains a separate, explicit cloud option and never activates automatically.

## Android Adreno GPU provider

Reproducible Termux build instructions, portable scripts, model profiles and troubleshooting are in [`android-termux/`](android-termux/README.md).

Tested Galaxy Z Fold 8 results:

| Profile | Model | Context | Prompt | Generation |
| --- | --- | ---: | ---: | ---: |
| `qwen3-4b` | Qwen3 4B Q4_K_M | 32K | 287 tok/s | 19.8 tok/s |
| `mistral-7b` | Mistral 7B Q4_K_M | 16K | 147 tok/s | 13.2 tok/s |
| `deepseek-r1-8b` | DeepSeek-R1/Qwen3 8B Q4_K_M | 8K | 141 tok/s | 11.5 tok/s |
| `gemma4-e4b` | Gemma 4 E4B Q4_0 | 8K | 203 tok/s | 17.7 tok/s |

The Android launcher runs one heavyweight inference backend at a time to avoid mobile memory pressure. It also restricts both backends to one model/request slot and holds a Termux wake lock while running.

```sh
privatellmlens                    # use the remembered backend
privatellmlens --gpu qwen3-4b    # switch to GPU and remember it
privatellmlens --ollama          # switch to Ollama and remember it
privatellmlens --gpu-list
privatellmlens --stop
```

The default is Ollama. After switching once, plain `privatellmlens` continues using the remembered backend. Never run a large Ollama model and a large llama.cpp GPU model concurrently on the phone.

## Ollama origins

The browser origin must be allowed to access Ollama. A broad personal-machine configuration is:

```sh
OLLAMA_ORIGINS="*" ollama serve
```

This permits any website in the browser to attempt local Ollama requests. Prefer an origin-specific allowlist such as `http://127.0.0.1:8765` where practical, then restart Ollama.

## Context profiles

- **8K Performance:** lower KV-cache use and faster prompt handling
- **16K Balanced:** default general-purpose Ollama context
- **32K Maximum / deep documents:** deeper conversations and document work
- **4K Utility:** automatically used for small classification, extraction and summarisation calls

Conversation History controls stored message count; Model Context controls Ollama `num_ctx`. llama.cpp GPU contexts are fixed by the active server profile.

## Memories

**Use Memories** is enabled by default. It decrypts and ranks active facts without another inference call, injecting at most 10 memories and approximately 600 tokens. **Learn Memories** is experimental and off by default; it performs idle-time local extraction and is aborted by new foreground work.

Memory records contain an encrypted fact, semantic key and confidence. Exact duplicates are ignored, newer conflicting facts supersede older ones, instruction-like content and likely secrets are rejected, and storage is capped at 200 records. The manager supports manual addition, editing and deletion.

## Search and cloud features

- **Web Search:** one explicit Tavily search
- **Auto-search:** a local decision followed by Tavily when current information appears necessary
- **Deep Web Research:** an explicit per-request iterative search workflow
- **Perplexity:** search-grounded cloud answers
- **OpenAI:** image generation
- **Gemini:** explicit cloud long-context file processing

Provider keys are stored in the WebCrypto vault. Leave a key unset to keep its integration unavailable.

## Local storage and privacy

PrivateLLMLens uses IndexedDB version 6 for threads, messages, encrypted memories, the WebCrypto vault, and encrypted document workspaces. Non-sensitive preferences remain in `localStorage`.

Provider keys, memories, document filenames and extracted document content use AES-256-GCM with fresh random IVs and authenticated record identity. The non-extractable vault key is stored in IndexedDB. This protects against casual storage inspection, not malicious JavaScript already executing in the application origin. CDN dependencies remain part of the trust boundary.

Browser storage is origin-scoped. Changing hostname, port, protocol or file origin creates a different storage area. Ordinary JSON export includes threads, messages and portable settings but deliberately excludes API keys, memories and document workspaces.

## PWA installation

Install from HTTPS, `http://localhost`, or `http://127.0.0.1`. Browsers do not permit installation from raw `file://` URLs. Use the header install button or the browser's **Add to Home screen** action.

## Development

There is no build step. Edit `index.html`, reload, and test against a local provider. A basic main-script syntax check is:

```sh
awk '/<script>/{inside=1;next} /<\/script>/{inside=0} inside{print}' index.html > /tmp/privatellmlens.js
node --check /tmp/privatellmlens.js
```

## License and contributions

Issues, pull requests, suggestions and stars are welcome. Security-sensitive changes should account for the single-file deployment model and the page's access to local conversations, documents and unlocked provider credentials.
