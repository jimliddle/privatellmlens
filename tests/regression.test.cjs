const test = require('node:test');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const { createApp, html, scripts } = require('./app.cjs');
const normalize = value => JSON.parse(JSON.stringify(value));

test('every inline script parses and PDF loads use the safe, version-matched adapter', () => {
  scripts.forEach(script => acorn.parse(script, { ecmaVersion: 'latest' }));
  assert(!html.includes('pdfjsLib.getDocument'));
  assert(html.includes('isEvalSupported: false'));
  assert(html.includes('pdfjs-dist@6.4.299'));
  assert(html.includes('dompurify@3.4.17'));
  assert(!html.includes('user-scalable=no'));
});

test('crafted filenames and progress labels remain inert plain text', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  app.run('pendingAttachments = [{type:"txt", fileName:"<img src=x onerror=alert(1)>.txt"}]; showMultiAttachmentPreview();');
  const preview = app.document.getElementById('attachmentPreview');
  assert.equal(preview.querySelector('img'), null);
  assert(preview.textContent.includes('<img src=x onerror=alert(1)>.txt'));
  app.run('showPendingAttachmentPreview({type:"pdf",fileName:"<svg onload=alert(1)>.pdf"}); setProcessingLabel(document.getElementById("messageHistory"), "Reading <img onerror=alert(1)>");');
  assert.equal(preview.querySelector('svg'), null);
  assert.equal(app.document.getElementById('messageHistory').querySelector('img'), null);
  assert.equal(app.run('safeExternalUrl("javascript:alert(1)")'), '');
  assert.equal(app.run('safeExternalUrl("https://example.com/source")'), 'https://example.com/source');
});

test('chat model discovery rejects embedding-only models and restores a valid saved choice', async t => {
  const app = createApp(async url => {
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3-embedding:0.6b' }, { name: 'unknown-encoder', capabilities: ['embedding'] }, { name: 'test-chat' }, { name: 'vision-chat', capabilities: ['completion', 'vision'] }] });
    if (String(url).endsWith('/api/show')) return Response.json({ capabilities: ['completion'] });
    return Response.json({ data: [] });
  });
  t.after(app.close); await app.boot();
  const options = [...app.document.getElementById('modelSelection').options].map(option => option.value);
  assert.deepEqual(options, ['test-chat', 'vision-chat']);
  app.window.localStorage.setItem('defaultModel', 'vision-chat');
  app.document.getElementById('modelSelection').innerHTML = '<option>Loading models...</option>';
  await app.run('fetchModels()');
  assert.equal(app.run('getModelSelection()'), 'vision-chat');
  app.window.localStorage.setItem('defaultModel', 'qwen3-embedding:0.6b');
  await app.run('fetchModels()');
  assert.notEqual(app.run('getModelSelection()'), 'qwen3-embedding:0.6b');
  assert.throws(() => app.run('assertModelSupportsImage("test-chat",{type:"image"})'), /does not support images/);
});

test('cloud cancellation prevents a late response from being saved in another thread', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  await app.run('setApiKey("perplexityApiKey","synthetic-test-key")');
  app.window.localStorage.setItem('autoTitle', 'false');
  let release, reached;
  const requestStarted = new Promise(resolve => { reached = resolve; });
  let signal;
  app.window.fetch = async (_url, options) => { signal = options.signal; reached(); return new Promise(resolve => { release = resolve; }); };
  app.document.getElementById('perplexitySearchCheckbox').checked = true;
  app.document.getElementById('userInput').value = 'A synthetic prompt in thread 1';
  const request = app.run('sendMessage()');
  await requestStarted;
  app.run('resetComposerForThreadChange(); currentThreadId=2;');
  assert(signal.aborted);
  await request;
  release(Response.json({ choices: [{ message: { content: 'A late reply' } }] }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const snapshot = await app.run('readBackupSnapshot()');
  assert.equal(snapshot.messages.filter(message => message.role === 'assistant').length, 0);
  assert.equal(snapshot.messages[0].threadId, 1);
  assert.equal(app.document.getElementById('sendButton').disabled, false);
});

test('an old request cannot clear or unlock a newer request’s composer', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  await app.run('setApiKey("perplexityApiKey","synthetic-test-key")');
  let reached;
  const started = new Promise(resolve => { reached = resolve; });
  app.window.fetch = async () => { reached(); return new Promise(() => {}); };
  app.document.getElementById('perplexitySearchCheckbox').checked = true;
  app.document.getElementById('userInput').value = 'First request';
  const first = app.run('sendMessage()');
  await started;
  app.run('resetComposerForThreadChange(); currentThreadId=2; beginForegroundRequest("New request"); pendingAttachment={fileName:"new.txt"};');
  app.document.getElementById('sendButton').disabled = true;
  await first;
  assert.equal(app.document.getElementById('sendButton').disabled, true);
  assert.equal(app.run('pendingAttachment.fileName'), 'new.txt');
  app.run('resetComposerForThreadChange()');
});

test('whole-document synthesis carries findings from all 32 sections through reduction', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const batches = [];
  app.window.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    batches.push(prompt);
    const markers = [...new Set(prompt.match(/\[D\d+\]/g) || [])];
    return Response.json({ message: { content: markers.map(marker => marker + ' preserved fact').join(' ') } });
  };
  app.run(`mapDocumentChunks=async()=>{
    const document={id:1,name:"Review.txt"};
    const partials=Array.from({length:32},(_,index)=>({workspaceDocument:document,chunk:{lineStart:index*100+1,lineEnd:index*100+100},text:("[D"+(index+1)+"] important evidence ").repeat(80)}));
    partials.analysedSections=32;return partials;
  };`);
  const result = await app.run('prepareDocumentContext([{id:1,name:"Review.txt",chunks:[{text:"x".repeat(90000),lineStart:1,lineEnd:3200}]}], "Review every section", [], "test-chat", document.getElementById("messageHistory"), "whole")');
  assert.equal(result.mode, 'whole-document');
  assert.equal(result.citations.length, 32);
  assert.equal(result.coverage.analysed, 32);
  assert(result.coverage.reductionPasses > 0);
  for (let i = 1; i <= 32; i++) assert(result.block.includes('[D' + i + ']'), 'Missing section ' + i);
  assert(batches.length > 1);
  assert.equal(app.run('getAvailableDocumentTokens([{content:"x".repeat(70000)}])'), 0);
});

test('direct context includes every source; exhausted context fails clearly instead of overflowing', async t => {
  const app=createApp();t.after(app.close);await app.boot();
  const result=await app.run('prepareDocumentContext([{id:1,name:"A.txt",chunks:[{text:"First fact",lineStart:1,lineEnd:1},{text:"Last fact",lineStart:2,lineEnd:2}]}],"Summarise",[],"test-chat",document.getElementById("messageHistory"))');
  assert.equal(result.mode,'direct');assert.equal(result.citations.length,2);assert(result.block.includes('Last fact'));
  await assert.rejects(app.run('prepareDocumentContext([{id:1,name:"A.txt",chunks:[{text:"Fact"}]}],"Question",[{content:"x".repeat(70000)}],"test-chat",document.getElementById("messageHistory"))'),/conversation fills/);
});

test('encrypted backup restores documents, cached embeddings, memories and citation identities', async t => {
  const app=createApp();t.after(app.close);await app.boot();
  await app.run(`(async()=>{
    const payload={name:"Private.pdf",type:"pdf",size:100,fullText:"Confidential document fact",chunks:[{text:"Confidential document fact",page:1,lineStart:1,lineEnd:1}],tokenEstimate:7,embeddingModel:"test",embeddingVersion:1,chunkEmbeddings:["AQID"]};
    const encrypted=await encryptDocumentPayload(payload,1);
    await new Promise((resolve,reject)=>{const tx=db.transaction(["documents","messages"],"readwrite");tx.objectStore("documents").add({id:7,threadId:1,contentHash:"hash",createdAt:1,...encrypted});tx.objectStore("messages").add({threadId:1,role:"assistant",text:"Supported fact [D1]",type:"text",timestamp:2,citations:[{type:"document",documentId:7,location:"page 1",label:"[D1] Private.pdf · page 1"}]});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    await saveMemoryCandidate({fact:"Prefers concise answers",key:"user:style"},1,true);
    await setApiKey("perplexityApiKey","SECRET-KEY-MUST-NOT-EXPORT");
  })()`);
  const data=normalize(await app.run('buildWorkspaceBackup()'));
  assert(!JSON.stringify(data).includes('SECRET-KEY-MUST-NOT-EXPORT'));
  app.window.backupFixture=data;
  const encrypted=normalize(await app.run('encryptWorkspaceBackup(backupFixture,"correct horse test passphrase")'));
  assert(!JSON.stringify(encrypted).includes('Confidential'));
  app.window.envelopeFixture=encrypted;
  await assert.rejects(app.run('decryptWorkspaceBackup(envelopeFixture,"wrong password")'),/incorrect or the file is damaged/);
  const decrypted=normalize(await app.run('decryptWorkspaceBackup(envelopeFixture,"correct horse test passphrase")'));
  assert.deepEqual(decrypted,data);
  app.window.restoreFixture=decrypted;
  const counts=normalize(await app.run('restoreBackupData(restoreFixture)'));
  assert.equal(counts.documents,1);assert.equal(counts.memories,1);
  const snapshot=await app.run('readBackupSnapshot()');
  const imported=snapshot.messages.find(message=>message.threadId!==1);
  const document=snapshot.documents.find(record=>record.threadId===imported.threadId);
  assert.equal(imported.citations[0].documentId,document.id);
  assert.notEqual(document.id,7);
  app.window.documentFixture=document;
  const restoredDoc=normalize(await app.run('decryptDocumentRecord(documentFixture)'));
  assert.equal(restoredDoc.fullText,'Confidential document fact');
  assert.deepEqual(restoredDoc.chunkEmbeddings,['AQID']);
  const memories=await app.run('loadAllMemories({includeSuperseded:true})');
  assert(memories.some(memory=>memory.sourceThreadId===imported.threadId&&memory.fact==='Prefers concise answers'));
});

test('legacy chat imports validate references and ignore endpoint or credential injection', async t => {
  const app=createApp();t.after(app.close);await app.boot();
  app.window.legacy={version:'2.0',threads:[{id:10,name:'Legacy',systemPrompt:'Helpful',created:1}],messages:[{threadId:10,role:'user',text:'Old conversation',timestamp:1}],settings:{theme:'dark',ollamaEndpoint:'https://attacker.invalid',perplexityApiKey:'injected',agentSearch:'true'}};
  await app.run('restoreBackupData(legacy)');
  assert.equal(app.window.localStorage.getItem('theme'),'dark');
  assert.equal(app.window.localStorage.getItem('ollamaEndpoint'),null);
  assert.equal(app.window.localStorage.getItem('perplexityApiKey'),null);
  const before=(await app.run('readBackupSnapshot()')).threads.length;
  app.window.invalid={...app.window.legacy,messages:[{threadId:99,role:'user',text:'Bad',timestamp:1}]};
  await assert.rejects(app.run('restoreBackupData(invalid)'),/Invalid backup/);
  assert.equal((await app.run('readBackupSnapshot()')).threads.length,before);
  // A synchronous structured-clone failure must roll back earlier queued writes as well.
  app.window.uncloneable={...app.window.legacy,threads:[{id:10,name:'Good'},{id:11,name:'Bad',uncloneable(){}}]};
  await assert.rejects(app.run('restoreBackupData(uncloneable)'));
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await app.run('readBackupSnapshot()')).threads.length,before);
});

test('saved whole-document responses render their coverage and sources', async t => {
  const app=createApp();t.after(app.close);await app.boot();
  const element=app.run('createMessageElement({id:1,role:"assistant",text:"Answer",type:"text",responseTime:"test · 1s",documentMode:"whole-document",documentCoverage:{analysed:32,total:32},citations:[]})');
  assert(element.textContent.includes('32/32 sections'));
});

test('accessible settings labels preserve API-key status badges and saving existing keys', async t => {
  const app=createApp();t.after(app.close);await app.boot();
  await app.run('setApiKey("perplexityApiKey","synthetic-configured-key")');
  assert.doesNotThrow(()=>app.run('openSettings()'));
  assert(app.document.getElementById('perplexityKeyBadge'));
  assert.equal(app.document.getElementById('perplexityApiKeyInput').value,'••••••••');
  app.run('closeSettings()');
  assert.equal(app.run('getApiKey("perplexityApiKey")'),'synthetic-configured-key');
});

test('very long document lines are split without losing tail facts or line provenance', async t => {
  const app=createApp();t.after(app.close);await app.boot();
  app.window.longLine='Important data '.repeat(3000)+'THE FINAL IMPORTANT FACT';
  const chunks=normalize(app.run('chunkTextWithLines(longLine,2400,0)'));
  assert(chunks.length>10);
  assert(chunks.every(chunk=>chunk.text.length<=2400&&chunk.lineStart===1&&chunk.lineEnd===1));
  assert.equal(chunks.map(chunk=>chunk.text).join(''),app.window.longLine);
  assert(chunks.at(-1).text.includes('THE FINAL IMPORTANT FACT'));
});
