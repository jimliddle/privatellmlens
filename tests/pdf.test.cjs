const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createApp } = require('./app.cjs');
const fixtures = require('./pdf-baseline.json');
const canonical = text => text.normalize('NFKD').replace(/\s+/g, '');
const hash = text => createHash('sha256').update(canonical(text)).digest('hex');

test('PDF upgrade retains the content of every page in the 17-page baseline', async () => {
  const library = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const fixture of fixtures) {
    const task = library.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(__dirname, '..', '.test-assets', fixture.name))), isEvalSupported: false, verbosity: 0 });
    const document = await task.promise;
    try {
      assert.equal(document.numPages, fixture.pageHashes.length);
      for (let number = 1; number <= document.numPages; number++) {
        const content = await (await document.getPage(number)).getTextContent();
        assert.equal(hash(content.items.map(item => item.str).join(' ')), fixture.pageHashes[number - 1], `${fixture.name}, page ${number} lost or changed content`);
      }
    } finally { await task.destroy(); }
  }
});

test('the app extracts PDF pages and provenance with evaluation disabled', async t => {
  const app = createApp(); t.after(app.close); await app.boot();
  const library = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let observedOptions;
  app.window.pdfFixtureLibrary = {
    getDocument(options) {
      observedOptions = options;
      return library.getDocument({ ...options, verbosity: 0, useWorkerFetch: false,
        standardFontDataUrl: path.join(__dirname, '..', 'node_modules/pdfjs-dist/standard_fonts/'),
        cMapUrl: path.join(__dirname, '..', 'node_modules/pdfjs-dist/cmaps/'),
        wasmUrl: path.join(__dirname, '..', 'node_modules/pdfjs-dist/wasm/')
      });
    }
  };
  app.run('pdfLibraryPromise = Promise.resolve(pdfFixtureLibrary)');
  const data = fs.readFileSync(path.join(__dirname, '..', '.test-assets/tracemonkey.pdf'));
  app.window.attachmentFixture = { type: 'pdf', fileName: 'Reference.pdf', file: { size: data.length, arrayBuffer: async () => new Uint8Array(data).buffer } };
  const result = await app.run('extractAttachmentDocument(attachmentFixture)');
  assert.equal(observedOptions.isEvalSupported, false);
  assert.equal(new Set(result.chunks.map(chunk => chunk.page)).size, 14);
  const pageTexts = Array.from({ length: 14 }, (_, index) => result.chunks.filter(chunk => chunk.page === index + 1).map(chunk => chunk.text));
  // Workspace chunks overlap by design. Compare the full extraction separately.
  assert.equal(result.fullText.split('\n\n').length, 14);
  assert.equal(hash(result.fullText), fixtures.find(fixture=>fixture.name==='tracemonkey.pdf').fullTextHash);
  assert(pageTexts.every(chunks => chunks.length > 0));
  assert(result.fullText.includes('Trace-based Just-in-Time'));
  assert(result.fullText.includes('References'));
});
