# PrivateLLMLens

PrivateLLMLens is a feature-rich, single-file chat interface for local Ollama models. It runs entirely in the browser, works on desktop and Android/Termux, and requires no application backend.

Try the hosted version: **https://jimliddle.github.io/privatellmlens/**

Alternatively, download `index.html` and open it locally. For PWA installation, serve the file from `localhost`, `127.0.0.1`, or HTTPS.

## Highlights

- Direct, streaming chat with any model exposed by Ollama
- Multiple conversation threads with editable system prompts
- Local conversation persistence using IndexedDB
- Text, PDF, CSV, HTML, Python, JSON, and image attachments
- Vision-model support through Ollama's `images` API
- Summarised or raw attachment processing
- Configurable conversation history
- Explicit 8K, 16K, and 32K Ollama context profiles
- 4K contexts for lightweight utility inference
- Real cancellation of active Ollama requests
- Local automatic thread titles without an extra inference call
- Markdown rendering, syntax highlighting, copy controls, regeneration, and branching
- Thread search, export/import, and PDF export
- Optional persistent memories
- Optional Tavily search and agent-style search loops
- Optional Perplexity search, OpenAI image generation, and Gemini long-context processing
- Optional in-browser WebGPU model
- Light, dark, and system themes
- Installable PWA metadata embedded in the single HTML file

## Why a single HTML file?

PrivateLLMLens is deliberately self-contained. The UI, styles, application logic, PWA manifest, and app icon are all embedded in `index.html`.

There is no PrivateLLMLens server and no account system. Local Ollama requests go directly from the browser to Ollama, while conversation data remains in browser storage. Optional cloud features make requests directly to their respective providers only when enabled.

Some third-party browser libraries are currently loaded from CDNs, including PDF.js, Marked, DOMPurify, Highlight.js, Font Awesome, and the optional WebGPU runtime.

## Requirements

- A modern Chromium-based browser is recommended
- Ollama running locally or on a reachable machine
- At least one Ollama model installed
- Ollama configured to permit requests from the origin used to open PrivateLLMLens

## Quick start

1. Start Ollama.
2. Install a model if needed:

   ```sh
   ollama pull qwen3:4b
   ```

3. Open the hosted application or download `index.html`.
4. Confirm that the connection indicator becomes active.
5. Select a model below the chat input and start a conversation.

PrivateLLMLens reads `/api/tags` to populate the model selector and sends chats to `/api/chat`.

## Ollama origins

The browser origin must be allowed to access Ollama. The broadest configuration is:

```sh
OLLAMA_ORIGINS="*"
```

This is convenient for a personal machine but permits any website loaded in the browser to attempt requests to the local Ollama API. Where possible, use a narrower list containing only the origin from which you run PrivateLLMLens.

Restart Ollama after changing the environment.

### macOS

For the current login session:

```sh
launchctl setenv OLLAMA_ORIGINS "*"
```

Restart the Ollama application afterward. Use a LaunchAgent if the setting must survive a reboot.

### Windows

Open **Edit the system environment variables**, select **Environment Variables**, and create a user variable:

```text
Name:  OLLAMA_ORIGINS
Value: *
```

Restart Ollama or reboot Windows.

### Android with Termux

Export the variable before starting Ollama:

```sh
export OLLAMA_ORIGINS="*"
ollama serve
```

Add the export to the shell startup file used by Termux if you want it applied automatically.

## Model context profiles

The Processing settings separate two different concepts:

- **Conversation History** controls how many recent messages are considered.
- **Model Context** controls the `num_ctx` value sent to Ollama.

Available model-context profiles:

| Profile | Context | Intended use |
| --- | ---: | --- |
| Performance | 8K | Faster chat and lower KV-cache memory use |
| Balanced | 16K | Default profile for general use |
| Maximum / deep documents | 32K | Long conversations and document-heavy work |

KV-cache memory grows roughly in proportion to context size. Relative to 32K, an 8K cache is approximately 25% and a 16K cache approximately 50%, although total RAM use depends heavily on the selected model, architecture, and quantisation.

Small utility calls—such as search decisions, attachment routing, clarification, summarisation, memory extraction, follow-up generation, and fact checking—use a 4K context automatically.

## Attachments

PrivateLLMLens supports:

- Plain text
- PDF
- CSV
- HTML
- Python
- JSON
- Images

Large text and PDF files can be processed in chunks and summarised before the final request. **Don't Summarize** concatenates the extracted content instead, which is useful when exact text, code, or structured data matters.

Images are converted to base64 and passed to compatible Ollama vision models through the `images` field.

Gemini long-context processing is optional and sends selected attachment content to Google's API. It is not a local/private operation.

## Web search and cloud features

All cloud integrations are optional:

- **Tavily**: manual search, automatic search decisions, agent loops, and optional fact checking
- **Perplexity**: search-grounded answers
- **OpenAI**: image generation
- **Gemini**: long-context file processing

These features send prompts, search queries, files, or generated content to the selected external provider. Leave a provider's API key unset to keep that integration disabled.

## Local storage and privacy

PrivateLLMLens currently uses IndexedDB version 5.

IndexedDB stores:

- Threads
- Messages and attachment data
- Persistent memories
- The WebCrypto vault

Non-sensitive preferences—such as theme, selected model, context profile, conversation-history length, endpoint, and feature toggles—are stored in `localStorage`.

### API-key protection

Provider API keys are encrypted using AES-256-GCM through the WebCrypto API. A non-extractable encryption key is stored in IndexedDB, each encrypted value uses a fresh random IV, and decrypted credentials are retained only in runtime memory.

Older plaintext API keys in `localStorage` are automatically migrated into the encrypted vault and removed.

This improves protection against casual inspection and direct `localStorage` extraction. It does not protect unlocked credentials from malicious JavaScript already executing in the same page. Because the application currently loads some dependencies from CDNs, vendoring and pinning all dependencies locally would provide stronger supply-chain protection.

Browser storage is scoped to the application's origin. Opening the same file through a different hostname, port, protocol, or file path may create a separate storage area.

## Streaming and cancellation

Ollama returns newline-delimited JSON. PrivateLLMLens buffers incomplete network fragments so that JSON records split across network chunks are not lost.

The Cancel control uses `AbortController` to disconnect the active Ollama request. It covers ordinary chat, regeneration, direct-answer mode, streamed generation, and foreground Ollama preprocessing. Local file-processing loops also observe cancellation.

## Memories and conversation summaries

Optional automatic memories extract useful preferences, project facts, and decisions into a dedicated IndexedDB store. Memories can be reviewed and deleted in Settings.

When automatic context summarisation is enabled, older messages can be compressed while recent messages remain verbatim. This helps long-running threads stay within the selected model context.

## WebGPU model

PrivateLLMLens can optionally load a small model directly in a compatible browser using WebGPU. Model assets are downloaded and cached by the browser.

The WebGPU path is separate from Ollama and intentionally disables features that depend on the Ollama agent/search workflow. Browser and device support varies.

## PWA installation

The web-app manifest, app icon, standalone metadata, and install-prompt handling are embedded directly in `index.html`.

Installation requires the application to be opened from:

- HTTPS
- `http://localhost`
- `http://127.0.0.1`

Browsers do not permit PWA installation from a raw `file://` URL. On Android, use the install button in the header or the browser's **Add to Home screen** command.

A service worker is not required merely to install the application. Reliable offline caching would require a separately served service-worker script, which cannot be registered from inline or `blob:` JavaScript under current browser security rules.

## Backup and portability

Use **Export** to download threads, messages, and portable settings as JSON. API keys are deliberately excluded.

Use **Import** to add an exported backup to the current browser database. Browser storage should not be treated as the only backup for important conversations.

## Security notes

- Rendered model Markdown is sanitised with DOMPurify.
- Search results are constructed with DOM nodes and `textContent` to prevent stored HTML injection.
- API keys are encrypted at rest in the browser vault.
- External provider use is explicit and optional.
- `OLLAMA_ORIGINS="*"` is convenient but broad; restrict it where practical.
- CDN-hosted dependencies remain part of the application's trust boundary.

## Development

The project intentionally has no build step. Edit `index.html`, reload the browser, and test against a running Ollama instance.

A useful syntax check for the main inline JavaScript is:

```sh
sed -n '/^  <script>$/,/^  <\/script>$/p' index.html \
  | sed '/^  <script>$/d;/^  <\/script>$/d' \
  | node --check -
```

## License and contributions

Issues, pull requests, suggestions, and stars are welcome. Before submitting security-sensitive changes, consider the single-file deployment model and the fact that PrivateLLMLens runs with access to local conversations and any unlocked provider credentials.
