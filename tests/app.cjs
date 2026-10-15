const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const createDOMPurify = require('dompurify');
const { marked } = require('marked');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

function createApp(fetchImpl) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8767/', runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window;
  Object.defineProperty(window, 'crypto', { value: webcrypto });
  Object.assign(window, {
    indexedDB: new IDBFactory(), IDBKeyRange, TextEncoder, TextDecoder, AbortController, AbortSignal,
    Response, Request, DOMPurify: createDOMPurify(window), marked,
    ResizeObserver: class { observe() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    alert() {}, confirm: () => true,
    fetch: fetchImpl || (async url => {
      if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'test-chat', capabilities: ['completion'], size: 1000 }] });
      if (String(url).endsWith('/api/show')) return Response.json({ capabilities: ['completion'] });
      if (String(url).endsWith('/v1/models')) return Response.json({ data: [] });
      return Response.json({ message: { content: 'Synthetic answer' }, choices: [{ message: { content: 'Synthetic answer' } }] });
    })
  });
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  let initialize;
  const addListener = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (type, callback, ...options) => {
    if (type === 'DOMContentLoaded') initialize = callback;
    else addListener(type, callback, ...options);
  };
  const context = dom.getInternalVMContext();
  scripts.forEach(script => vm.runInContext(script, context));
  const run = code => vm.runInContext(code, context);
  return {
    window, document: window.document, run, close: () => dom.window.close(),
    async boot() {
      await initialize();
      for (let i = 0; i < 100; i++) {
        if (run('currentThreadId') && window.document.getElementById('modelSelection').value === 'test-chat') return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error('App did not initialize');
    }
  };
}

module.exports = { createApp, html, scripts };
