from pathlib import Path

index = Path('index.html')
text = index.read_text(encoding='utf-8')

old = '''    async function runAgentLoop(messages, modelUsed, placeholder) {
      return runToolAgent(messages, modelUsed, placeholder, {
        allowExternalSearch: true,
        maxWebSearches: TOOL_AGENT_MAX_WEB_SEARCHES
      });
    }
'''
new = '''    async function runAgentLoop(messages, modelUsed, placeholder, initialDocumentCitations = []) {
      return runToolAgent(messages, modelUsed, placeholder, {
        allowExternalSearch: true,
        maxWebSearches: TOOL_AGENT_MAX_WEB_SEARCHES,
        initialDocumentCitations
      });
    }
'''
if old not in text:
    raise SystemExit('runAgentLoop refinement anchor not found')
text = text.replace(old, new, 1)

old = '              const agentResult = await runAgentLoop(messages, modelUsed, placeholder);\n'
new = '              const agentResult = await runAgentLoop(messages, modelUsed, placeholder, documentCitations);\n'
if old not in text:
    raise SystemExit('runAgentLoop caller anchor not found')
text = text.replace(old, new, 1)
index.write_text(text, encoding='utf-8')

core = Path('corefunctionality.md')
core_text = core.read_text(encoding='utf-8')
heading = '#### Agentic Features (Standard — on by default)\n'
section = '''#### Local Tool Framework

- **Schema-driven registry** — browser tools are defined once with a name, description, JSON parameter schema, privacy classification (`local` or `external`), availability rule and executor.
- **Local Tools mode** — explicit per-prompt mode exposes only browser-local tools; it does not expose public web search.
- **Initial local tools** — safe calculator, browser current date/time, encrypted workspace document listing, hybrid document search, exact document reading and simple JSON-path inspection.
- **Document provenance** — document search/read reuses the existing clickable source citations and continues citation numbering from any passages already selected by the normal document pipeline.
- **Native provider schemas** — Ollama receives native function schemas; OpenAI-compatible llama.cpp receives the same function definitions through its chat-completions adapter.
- **Compatibility fallback** — browser WebGPU models and local-server models without usable native tool calling use a constrained JSON action protocol over the same registry.
- **Privacy metadata** — every tool is marked `local` or `external`. Deep Web Research uses the same registry but may additionally expose Tavily `web_search`, which is explicitly external and limited to three searches.
- **Bounded execution** — tool-agent loops have fixed step/result limits, treat tool output as untrusted data, and force a final answer when the step budget is exhausted.

---

'''
if '#### Local Tool Framework\n' not in core_text:
    if heading not in core_text:
        raise SystemExit('corefunctionality insertion anchor not found')
    core_text = core_text.replace(heading, section + heading, 1)
    core.write_text(core_text, encoding='utf-8')

print('Local tool refinements applied')
