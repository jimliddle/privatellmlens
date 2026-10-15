const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

async function routeApp(context, chatHandler) {
  await context.addInitScript(() => {
    for (const name of ['autoTitle', 'autoSummarise', 'learnMemories', 'autoFactCheck', 'suggestedFollowUps']) localStorage.setItem(name, 'false');
    localStorage.setItem('defaultModel', 'test-chat');
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const json = data => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
    if (url.pathname === '/api/tags') return json({ models: [{ name: 'qwen3-embedding:0.6b', capabilities: ['embedding'] }, { name: 'test-chat', capabilities: ['completion', 'vision'] }] });
    if (url.pathname === '/api/show') return json({ capabilities: ['completion', 'vision'] });
    if (url.pathname === '/v1/models') return json({ data: [{ id: 'qwen3-4b-gpu' }] });
    if (url.pathname === '/api/chat' || url.pathname === '/v1/chat/completions') {
      const body = request.postDataJSON();
      if (chatHandler) return chatHandler(route, body, url);
      if (body.tools) return json({ message: { content: '', tool_calls: [{ function: { name: 'calculate', arguments: { expression: '2+2' } } }] } });
      if (!body.stream) return json({ message: { content: 'The answer is 4.' }, choices: [{ message: { content: 'The answer is 4.' } }] });
      const text = 'A synthetic answer with preserved local functionality.';
      const output = url.pathname === '/api/chat' ? JSON.stringify({ message: { content: text } }) + '\n' + JSON.stringify({ done: true }) + '\n' : 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n';
      return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: url.pathname === '/api/chat' ? 'application/x-ndjson' : 'text/event-stream', body: output });
    }
    if (url.hostname === '127.0.0.1' && url.port === '18767') return route.continue();
    if (url.pathname.includes('dompurify@3.4.17')) return route.fulfill({ contentType: 'text/javascript', path: path.join(root, 'node_modules/dompurify/dist/purify.min.js') });
    if (url.pathname.includes('marked@18.1.1')) return route.fulfill({ contentType: 'text/javascript', path: path.join(root, 'node_modules/marked/lib/marked.umd.js') });
    if (url.pathname.includes('jszip/3.10.1')) return route.fulfill({ contentType: 'text/javascript', path: path.join(root, 'node_modules/jszip/dist/jszip.min.js') });
    const pdfPath = url.pathname.split('pdfjs-dist@6.4.299/')[1];
    if (pdfPath) {
      const file = path.resolve(root, 'node_modules/pdfjs-dist', pdfPath);
      if (file.startsWith(path.join(root, 'node_modules/pdfjs-dist') + path.sep) && fs.existsSync(file)) return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream', path: file });
    }
    if (url.pathname.includes('highlight.min.js')) return route.fulfill({ contentType: 'text/javascript', body: 'window.hljs={highlightElement(){}};' });
    if (url.pathname.includes('coi-serviceworker')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    // Unrelated fonts, icons and model downloads are not needed for these functional tests.
    return route.abort();
  });
}

async function openApp(page) {
  await page.goto('/');
  await expect.poll(() => page.locator('#modelSelection').inputValue()).toBe('test-chat');
  await expect(page.locator('#threadsList')).toContainText('General');
}

test('phone and desktop controls remain visible and dialogs have keyboard focus', async ({ page, context }) => {
  await routeApp(context); await openApp(page);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('#settingsButton').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('#settingsButton').click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Theme', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Auto-title Threads', { exact: true })).toBeVisible();
    await page.locator('#settingsFooter button').last().focus();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#settingsButton')).toBeFocused();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#headerMoreButton').click();
  await expect(page.locator('#headerSecondaryActions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#headerSecondaryActions')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/phone-layout.png' });
});

test('Ollama chat, local tools and llama.cpp streaming still work', async ({ page, context }) => {
  await routeApp(context); await openApp(page);
  await page.locator('#userInput').fill('Hello'); await page.locator('#sendButton').click();
  await expect(page.locator('.assistant-message').last()).toContainText('preserved local functionality');
  await page.locator('#localToolsCheckbox').check();
  await page.locator('#userInput').fill('Calculate 2+2'); await page.locator('#sendButton').click();
  await expect(page.locator('.assistant-message').last()).toContainText('The answer is 4');
  await page.locator('#modelSelection').selectOption('__llamacpp__:qwen3-4b-gpu');
  await page.locator('#userInput').fill('Hello from llama.cpp'); await page.locator('#sendButton').click();
  await expect(page.locator('.assistant-message').last()).toContainText('preserved local functionality');
  await expect(page.locator('#sendButton')).toBeEnabled();
});

test('attachment names cannot create markup or execute handlers', async ({ page, context }) => {
  await routeApp(context); await openApp(page);
  await page.locator('#fileInput').setInputFiles({ name: '<img src=x onerror=window.__injected=1>.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic document') });
  await expect(page.locator('#attachmentPreview')).toContainText('<img src=x onerror=window.__injected=1>.txt');
  await expect(page.locator('#attachmentPreview img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
});

test('PDF import keeps text, page citations and the source passage viewer', async ({ page, context }) => {
  await routeApp(context); await openApp(page);
  await page.locator('#chatContextSelection').selectOption('32768');
  await page.locator('#fileInput').setInputFiles(path.join(root, '.test-assets/tracemonkey.pdf'));
  await page.locator('#userInput').fill('Summarise the paper'); await page.locator('#sendButton').click();
  await expect(page.locator('.assistant-message').last()).toContainText('preserved local functionality', { timeout: 20000 });
  const data = await page.evaluate(async () => {
    const documents = await getThreadDocuments();
    const messages = await getThreadMessages(currentThreadId);
    return { pages: [...new Set(documents[0].chunks.map(chunk => chunk.page))], fullText: documents[0].fullText, citations: messages.at(-1).citations };
  });
  expect(data.pages).toHaveLength(14);
  expect(data.fullText).toContain('Trace-based Just-in-Time');
  expect(data.citations.some(citation => citation.location === 'page 14')).toBe(true);
  await page.locator('.assistant-message').last().locator('.citation-link').first().click();
  await expect(page.getByRole('dialog', { name: /tracemonkey.pdf/ })).toBeVisible();
  await expect(page.locator('#documentSourceOverlay pre')).toContainText('Trace-based');
  await page.keyboard.press('Escape');
  await expect(page.locator('#documentSourceOverlay')).toHaveCount(0);
});

test('workspace backup downloads encrypted data and restores usable documents and memories', async ({ page, context, browser }) => {
  await routeApp(context); await openApp(page);
  await page.evaluate(async () => {
    const file = new File(['Synthetic private workspace text'], 'Backup.txt', { type: 'text/plain' });
    const document = await persistAttachmentDocument({ type: 'txt', fileName: file.name, file }, currentThreadId);
    await saveMessage({ role: 'assistant', text: 'Evidence [D1]', type: 'text', timestamp: 1, citations: [{ type: 'document', documentId: document.id, location: 'lines 1–1', label: '[D1] Backup.txt' }] });
    await saveMemoryCandidate({ fact: 'Synthetic preference', key: 'user:test' }, currentThreadId, true);
  });
  await page.evaluate(() => openBackupDialog());
  await page.locator('#backupPassword').fill('test passphrase sufficiently long');
  await page.locator('#backupPasswordConfirm').fill('test passphrase sufficiently long');
  const downloaded = page.waitForEvent('download');
  await page.locator('#backupAction').click();
  const filename = await (await downloaded).path();
  const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'));
  expect(envelope.format).toBe('PrivateLLMLens.encrypted-workspace');
  expect(JSON.stringify(envelope)).not.toContain('Synthetic private');
  const targetContext = await browser.newContext({ serviceWorkers: 'block' });
  await routeApp(targetContext);
  const target = await targetContext.newPage();
  target.on('dialog', dialog => dialog.accept());
  await openApp(target);
  await target.locator('#importInput').setInputFiles({ name: 'backup.pllbackup', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) });
  await target.locator('#backupPassword').fill('test passphrase sufficiently long');
  await target.locator('#backupAction').click();
  await expect(target.locator('#backupStatus')).toContainText('Restored 1 threads, 1 documents and 1 memories');
  const restored = await target.evaluate(async () => {
    const data = await readBackupSnapshot();
    const record = data.documents[0];
    const document = await decryptDocumentRecord(record);
    const memory = await loadAllMemories();
    return { text: document.fullText, source: data.messages[0].citations[0].documentId === record.id, memories: memory.map(item => item.fact) };
  });
  expect(restored.text).toBe('Synthetic private workspace text');
  expect(restored.source).toBe(true);
  expect(restored.memories).toContain('Synthetic preference');
  await targetContext.close();
});
