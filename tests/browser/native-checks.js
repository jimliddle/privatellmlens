(async () => {
  const report = document.createElement('pre');
  report.id = 'nativeTestResults';
  report.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;max-height:32vh;overflow:auto;z-index:2000;padding:12px;background:#fff;color:#111;border:1px solid #777;white-space:pre-wrap;font:12px/1.4 monospace;';
  document.body.appendChild(report);
  const results = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const wait = async condition => {
    for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Browser test timed out');
  };
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.stack || error.message }); }
    report.textContent = JSON.stringify({ status: 'running', results }, null, 2);
  };
  await wait(() => typeof db !== 'undefined' && db && currentThreadId && getModelSelection() === 'test-chat');
  await test('chat-capable model selection', async () => {
    check(!Array.from(document.getElementById('modelSelection').options).some(option => /embedding/.test(option.value)), 'Embedding model was exposed for chat');
  });
  await test('Ollama, tools and llama.cpp streaming', async () => {
    const input = document.getElementById('userInput');
    input.value = 'Synthetic local chat'; await sendMessage();
    check((await getThreadMessages(currentThreadId)).at(-1).text.includes('confirms streaming'), 'Ollama stream failed');
    document.getElementById('localToolsCheckbox').checked = true;
    input.value = 'Calculate 2+2'; await sendMessage();
    check((await getThreadMessages(currentThreadId)).at(-1).text.includes('answer is 4'), 'Local tools failed');
    document.getElementById('modelSelection').value = '__llamacpp__:qwen3-4b-gpu';
    document.getElementById('modelSelection').dispatchEvent(new Event('change'));
    input.value = 'Synthetic llama.cpp chat'; await sendMessage();
    check((await getThreadMessages(currentThreadId)).at(-1).text.includes('confirms streaming'), 'llama.cpp SSE failed');
    document.getElementById('modelSelection').value = 'test-chat';
    document.getElementById('modelSelection').dispatchEvent(new Event('change'));
  });
  await test('filename and progress-label safety', async () => {
    showPendingAttachmentPreview({ type: 'txt', fileName: '<img src=x onerror=alert(1)>.txt' });
    check(!document.getElementById('attachmentPreview').querySelector('img'), 'Filename became HTML');
    clearPendingAttachment();
  });
  await test('PDF browser worker, extraction and source viewer', async () => {
    const response = await nativeFixtureFetch('/.test-assets/tracemonkey.pdf');
    const file = new File([await response.arrayBuffer()], 'Reference.pdf', { type: 'application/pdf' });
    const record = await persistAttachmentDocument({ type: 'pdf', fileName: file.name, file }, currentThreadId);
    check(new Set(record.chunks.map(chunk => chunk.page)).size === 14, 'PDF lost page provenance');
    check(record.fullText.includes('Trace-based Just-in-Time'), 'PDF text was lost');
    await saveMessage({ role: 'assistant', type: 'text', text: 'Evidence [D1]', timestamp: Date.now(), citations: [documentCitation(record, record.chunks.at(-1), 1)] });
    await openDocumentSource(record.id, 'page 14');
    check(document.getElementById('documentSourceOverlay').querySelector('pre').textContent.length > 100, 'Source passage viewer failed');
    document.getElementById('documentSourceOverlay').querySelector('button').click();
  });
  await test('encrypted workspace restore and source remapping', async () => {
    await saveMemoryCandidate({ fact: 'Synthetic preference', key: 'user:test' }, currentThreadId, true);
    await setApiKey('perplexityApiKey', 'SYNTHETIC-KEY-MUST-NOT-BE-EXPORTED');
    const data = await buildWorkspaceBackup();
    check(!JSON.stringify(data).includes('SYNTHETIC-KEY-MUST-NOT-BE-EXPORTED'), 'API key escaped into backup');
    const envelope = await encryptWorkspaceBackup(data, 'a synthetic test passphrase');
    check(!JSON.stringify(envelope).includes('Synthetic preference'), 'Backup contains plaintext');
    const restored = await restoreBackupData(await decryptWorkspaceBackup(envelope, 'a synthetic test passphrase'));
    check(restored.documents === 1 && restored.memories === 1, 'Workspace backup lost records');
    const snapshot = await readBackupSnapshot();
    const message = snapshot.messages.find(message => message.threadId !== 1 && message.citations?.length);
    const source = snapshot.documents.find(document => document.id === message.citations[0].documentId);
    check(source?.threadId === message.threadId, 'Restored citation points to another thread');
  });
  await test('cloud cancellation and thread isolation', async () => {
    const sourceThread = currentThreadId;
    const original = await readBackupSnapshot();
    await new Promise((resolve, reject) => { const tx = db.transaction(['threads'], 'readwrite'); tx.objectStore('threads').add({ id: 2, name: 'Cancellation test', created: Date.now() }); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    document.getElementById('perplexitySearchCheckbox').checked = true;
    document.getElementById('userInput').value = 'A synthetic delayed cloud request';
    const request = sendMessage();
    await wait(() => window.nativeDelayedRequest);
    selectThread(2);
    await request;
    check(window.nativeDelayedRequest.signal.aborted, 'Cloud request did not receive cancellation');
    window.nativeDelayedRequest.release();
    await new Promise(resolve => setTimeout(resolve, 20));
    const snapshot = await readBackupSnapshot();
    check(snapshot.messages.filter(message => message.role === 'assistant').length === original.messages.filter(message => message.role === 'assistant').length, 'Stale cloud answer was saved');
    document.getElementById('perplexitySearchCheckbox').checked = false;
    selectThread(sourceThread);
  });
  report.textContent = JSON.stringify({ status: results.every(result => result.passed) ? 'PASS' : 'FAIL', results }, null, 2);
})().catch(error => {
  const report = document.getElementById('nativeTestResults');
  report.textContent = JSON.stringify({ status: 'FAIL', error: error.stack || error.message }, null, 2);
});
