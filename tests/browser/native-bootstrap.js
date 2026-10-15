window.nativeFixtureFetch = window.fetch.bind(window);
for (const name of ['autoTitle', 'autoSummarise', 'learnMemories', 'autoFactCheck', 'suggestedFollowUps']) localStorage.setItem(name, 'false');
localStorage.setItem('defaultModel', 'test-chat');
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'qwen3-embedding:0.6b', capabilities: ['embedding'] }, { name: 'test-chat', capabilities: ['completion', 'vision'] }] });
  if (url.pathname === '/api/show') return Response.json({ capabilities: ['completion', 'vision'] });
  if (url.pathname === '/v1/models') return Response.json({ data: [{ id: 'qwen3-4b-gpu' }] });
  if (url.hostname === 'api.perplexity.ai') return new Promise(resolve => { window.nativeDelayedRequest = { signal: options.signal, release: () => resolve(Response.json({ choices: [{ message: { content: 'Late reply must not be saved' } }] })) }; });
  if (url.pathname === '/api/chat' || url.pathname === '/v1/chat/completions') {
    const body = JSON.parse(options.body);
    if (!body.stream) {
      if (body.tools && !body.messages.some(message => message.role === 'tool')) return Response.json({ message: { content: '', tool_calls: [{ function: { name: 'calculate', arguments: { expression: '2+2' } } }] } });
      return Response.json({ message: { content: 'The answer is 4.' }, choices: [{ message: { content: 'The answer is 4.' } }] });
    }
    const text = 'Synthetic browser response confirms streaming.';
    const content = url.pathname === '/api/chat' ? JSON.stringify({ message: { content: text } }) + '\n' + JSON.stringify({ done: true }) + '\n' : 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n';
    return new Response(content, { headers: { 'Content-Type': url.pathname === '/api/chat' ? 'application/x-ndjson' : 'text/event-stream' } });
  }
  return window.nativeFixtureFetch(input, options);
};
