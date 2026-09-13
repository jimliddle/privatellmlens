from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old_rank = r'''    function rankDocumentChunks(documents, query) {
      const queryTerms = documentTerms(query);
      const querySet = new Set(queryTerms);
      const phrase = String(query || "").toLowerCase().trim();
      const all = documents.flatMap(workspaceDocument => workspaceDocument.chunks.map(chunk => ({ workspaceDocument, chunk })));
      const documentFrequency = new Map();
      querySet.forEach(term => {
        documentFrequency.set(term, all.reduce((count, item) => count + (documentTerms(item.chunk.text).includes(term) ? 1 : 0), 0));
      });
      return all.map(item => {
        const terms = documentTerms(`${item.workspaceDocument.name} ${item.chunk.text}`);
        const frequencies = new Map();
        terms.forEach(term => frequencies.set(term, (frequencies.get(term) || 0) + 1));
        let score = 0;
        querySet.forEach(term => {
          const tf = frequencies.get(term) || 0;
          if (!tf) return;
          const idf = Math.log(1 + all.length / (1 + (documentFrequency.get(term) || 0)));
          score += (1 + Math.log(tf)) * idf;
        });
        if (phrase.length > 5 && item.chunk.text.toLowerCase().includes(phrase)) score += 12;
        return { ...item, score };
      }).sort((a, b) => b.score - a.score);
    }
'''

new_rank = r'''    // Hybrid local retrieval: BM25 lexical ranking + local MiniLM embeddings.
    // Embedding inference runs in a WASM worker so it does not compete with WebGPU chat models.
    const DOCUMENT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
    const DOCUMENT_EMBEDDING_VERSION = 1;
    const DOCUMENT_EMBEDDING_BATCH_SIZE = 8;
    const DOCUMENT_HYBRID_CANDIDATES = 32;
    let documentEmbeddingWorker = null;
    let documentEmbeddingRequestId = 0;
    let documentEmbeddingProgressPlaceholder = null;
    let documentEmbeddingsDisabledForSession = false;
    const documentEmbeddingRequests = new Map();

    function rankDocumentChunks(documents, query) {
      const queryTerms = documentTerms(query);
      const querySet = new Set(queryTerms);
      const phrase = String(query || "").toLowerCase().trim();
      const all = documents.flatMap(workspaceDocument => workspaceDocument.chunks.map((chunk, chunkIndex) => ({ workspaceDocument, chunk, chunkIndex })));
      if (!all.length) return [];

      const prepared = all.map(item => {
        const terms = documentTerms(item.chunk.text);
        const nameTerms = new Set(documentTerms(item.workspaceDocument.name));
        const frequencies = new Map();
        terms.forEach(term => frequencies.set(term, (frequencies.get(term) || 0) + 1));
        return { ...item, terms, nameTerms, frequencies, documentLength: Math.max(1, terms.length) };
      });
      const averageLength = prepared.reduce((sum, item) => sum + item.documentLength, 0) / prepared.length;
      const documentFrequency = new Map();
      querySet.forEach(term => {
        documentFrequency.set(term, prepared.reduce((count, item) => count + (item.frequencies.has(term) ? 1 : 0), 0));
      });
      const k1 = 1.2;
      const b = 0.75;

      return prepared.map(item => {
        let score = 0;
        querySet.forEach(term => {
          const tf = item.frequencies.get(term) || 0;
          const df = documentFrequency.get(term) || 0;
          if (tf) {
            const idf = Math.log(1 + (prepared.length - df + 0.5) / (df + 0.5));
            const denominator = tf + k1 * (1 - b + b * (item.documentLength / Math.max(1, averageLength)));
            score += idf * ((tf * (k1 + 1)) / denominator);
            if (item.nameTerms.has(term)) score += idf * 0.65;
          }
        });
        if (phrase.length > 5 && item.chunk.text.toLowerCase().includes(phrase)) score += 6;
        return { workspaceDocument: item.workspaceDocument, chunk: item.chunk, chunkIndex: item.chunkIndex, score, lexicalScore: score };
      }).sort((a, b) => b.score - a.score);
    }

    function documentEmbeddingExcerpt(workspaceDocument, chunk) {
      const compact = String(chunk?.text || "").replace(/\s+/g, " ").trim();
      if (compact.length <= 1000) return `${workspaceDocument.name}\n${compact}`;
      const edge = 300;
      const middle = Math.floor(compact.length / 2);
      const middleStart = Math.max(edge, middle - 150);
      return `${workspaceDocument.name}\n${compact.slice(0, edge)} … ${compact.slice(middleStart, middleStart + 300)} … ${compact.slice(-edge)}`;
    }

    function encodeDocumentEmbedding(vector) {
      const bytes = new Uint8Array(vector.length);
      for (let i = 0; i < vector.length; i++) {
        const signed = Math.max(-127, Math.min(127, Math.round(Number(vector[i] || 0) * 127)));
        bytes[i] = signed < 0 ? signed + 256 : signed;
      }
      return bytesToBase64(bytes);
    }

    function signedEmbeddingByte(byte) {
      return byte > 127 ? byte - 256 : byte;
    }

    function cosineWithStoredEmbedding(queryVector, encoded) {
      if (!encoded || !queryVector?.length) return 0;
      const bytes = base64ToBytes(encoded);
      const length = Math.min(queryVector.length, bytes.length);
      let dot = 0;
      let storedNorm = 0;
      for (let i = 0; i < length; i++) {
        const stored = signedEmbeddingByte(bytes[i]) / 127;
        dot += queryVector[i] * stored;
        storedNorm += stored * stored;
      }
      return storedNorm > 0 ? dot / Math.sqrt(storedNorm) : 0;
    }

    function cosineStoredEmbeddings(encodedA, encodedB) {
      if (!encodedA || !encodedB) return 0;
      const a = base64ToBytes(encodedA);
      const b = base64ToBytes(encodedB);
      const length = Math.min(a.length, b.length);
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < length; i++) {
        const av = signedEmbeddingByte(a[i]);
        const bv = signedEmbeddingByte(b[i]);
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
      }
      return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
    }

    function updateDocumentEmbeddingStatus(text) {
      if (documentEmbeddingProgressPlaceholder?.isConnected) documentEmbeddingProgressPlaceholder.textContent = text;
    }

    function ensureDocumentEmbeddingWorker(placeholder) {
      if (documentEmbeddingsDisabledForSession) throw new Error("Local semantic retrieval is unavailable in this session");
      if (!window.Worker || !window.WebAssembly) throw new Error("This browser cannot run the local embedding worker");
      documentEmbeddingProgressPlaceholder = placeholder || null;
      if (documentEmbeddingWorker) return documentEmbeddingWorker;

      const workerSource = `
let extractor = null;
const MODEL = ${JSON.stringify(DOCUMENT_EMBEDDING_MODEL)};
async function ensureExtractor() {
  if (extractor) return extractor;
  const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0');
  extractor = await pipeline('feature-extraction', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (info) => {
      const progress = Number(info?.progress);
      self.postMessage({ type: 'progress', progress: Number.isFinite(progress) ? progress : null });
    }
  });
  self.postMessage({ type: 'ready' });
  return extractor;
}
self.onmessage = async (event) => {
  const { id, texts } = event.data || {};
  try {
    const pipe = await ensureExtractor();
    const output = await pipe(texts, { pooling: 'mean', normalize: true });
    self.postMessage({ type: 'result', id, embeddings: output.tolist() });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  }
};`;
      documentEmbeddingWorker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" })));
      documentEmbeddingWorker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "progress") {
          const suffix = Number.isFinite(message.progress) ? ` ${Math.round(message.progress)}%` : "";
          updateDocumentEmbeddingStatus(`Loading local retrieval model…${suffix}`);
          return;
        }
        if (message.type === "ready") return;
        const pending = documentEmbeddingRequests.get(message.id);
        if (!pending) return;
        documentEmbeddingRequests.delete(message.id);
        if (message.type === "result") pending.resolve(message.embeddings || []);
        else pending.reject(new Error(message.message || "Local embedding failed"));
      };
      documentEmbeddingWorker.onerror = (event) => {
        const error = new Error(event.message || "Local embedding worker failed");
        documentEmbeddingRequests.forEach(request => request.reject(error));
        documentEmbeddingRequests.clear();
        documentEmbeddingWorker?.terminate();
        documentEmbeddingWorker = null;
        documentEmbeddingsDisabledForSession = true;
      };
      return documentEmbeddingWorker;
    }

    function embedDocumentTexts(texts, placeholder) {
      const worker = ensureDocumentEmbeddingWorker(placeholder);
      const id = ++documentEmbeddingRequestId;
      return new Promise((resolve, reject) => {
        documentEmbeddingRequests.set(id, { resolve, reject });
        worker.postMessage({ id, texts });
      });
    }

    async function persistDocumentEmbeddingCache(workspaceDocument) {
      const payload = {
        name: workspaceDocument.name,
        type: workspaceDocument.type,
        size: workspaceDocument.size,
        fullText: workspaceDocument.fullText,
        chunks: workspaceDocument.chunks,
        tokenEstimate: workspaceDocument.tokenEstimate,
        embeddingModel: workspaceDocument.embeddingModel,
        embeddingVersion: workspaceDocument.embeddingVersion,
        chunkEmbeddings: workspaceDocument.chunkEmbeddings
      };
      const encrypted = await encryptDocumentPayload(payload, Number(workspaceDocument.threadId), workspaceDocument.cryptoId);
      const record = {
        id: workspaceDocument.id,
        threadId: Number(workspaceDocument.threadId),
        contentHash: workspaceDocument.contentHash,
        createdAt: workspaceDocument.createdAt || Date.now(),
        ...encrypted
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["documents"], "readwrite");
        const request = tx.objectStore("documents").put(record);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      Object.assign(workspaceDocument, encrypted);
    }

    async function ensureDocumentEmbeddings(workspaceDocument, placeholder) {
      const cached = workspaceDocument.embeddingModel === DOCUMENT_EMBEDDING_MODEL
        && workspaceDocument.embeddingVersion === DOCUMENT_EMBEDDING_VERSION
        && Array.isArray(workspaceDocument.chunkEmbeddings)
        && workspaceDocument.chunkEmbeddings.length === workspaceDocument.chunks.length;
      if (cached) return workspaceDocument.chunkEmbeddings;

      const texts = workspaceDocument.chunks.map(chunk => documentEmbeddingExcerpt(workspaceDocument, chunk));
      const encoded = [];
      for (let start = 0; start < texts.length; start += DOCUMENT_EMBEDDING_BATCH_SIZE) {
        if (activeRequestController?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
        const end = Math.min(start + DOCUMENT_EMBEDDING_BATCH_SIZE, texts.length);
        updateDocumentEmbeddingStatus(`Building local semantic index… ${start + 1}–${end}/${texts.length}`);
        const embeddings = await embedDocumentTexts(texts.slice(start, end), placeholder);
        embeddings.forEach(vector => encoded.push(encodeDocumentEmbedding(vector)));
      }

      workspaceDocument.embeddingModel = DOCUMENT_EMBEDDING_MODEL;
      workspaceDocument.embeddingVersion = DOCUMENT_EMBEDDING_VERSION;
      workspaceDocument.chunkEmbeddings = encoded;
      try {
        await persistDocumentEmbeddingCache(workspaceDocument);
      } catch (error) {
        console.warn("Could not persist semantic document index; using it in memory for this session:", error);
      }
      return encoded;
    }

    function fuseDocumentRanks(lexical, semantic) {
      const fused = new Map();
      const add = (item, rank, weight, field) => {
        const key = `${item.workspaceDocument.id}:${item.chunkIndex}`;
        const current = fused.get(key) || { ...item, hybridScore: 0, lexicalScore: 0, semanticScore: 0 };
        current.hybridScore += weight / (60 + rank + 1);
        current[field] = item[field] || item.score || 0;
        fused.set(key, current);
      };
      lexical.filter(item => item.lexicalScore > 0).slice(0, DOCUMENT_HYBRID_CANDIDATES).forEach((item, rank) => add(item, rank, 0.45, "lexicalScore"));
      semantic.filter(item => item.semanticScore > 0).slice(0, DOCUMENT_HYBRID_CANDIDATES).forEach((item, rank) => add(item, rank, 0.55, "semanticScore"));
      return Array.from(fused.values()).sort((a, b) => b.hybridScore - a.hybridScore);
    }

    function diversifyDocumentResults(ranked, limit = 16) {
      if (ranked.length <= 1) return ranked;
      const pool = ranked.slice(0, DOCUMENT_HYBRID_CANDIDATES);
      const maxRelevance = Math.max(...pool.map(item => item.hybridScore || 0), 1e-9);
      const selected = [];
      while (pool.length && selected.length < limit) {
        let bestIndex = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < pool.length; i++) {
          const item = pool[i];
          const relevance = (item.hybridScore || 0) / maxRelevance;
          let redundancy = 0;
          let adjacentPenalty = 0;
          selected.forEach(chosen => {
            if (item.embedding && chosen.embedding) redundancy = Math.max(redundancy, Math.max(0, cosineStoredEmbeddings(item.embedding, chosen.embedding)));
            if (item.workspaceDocument.id === chosen.workspaceDocument.id && Math.abs(item.chunkIndex - chosen.chunkIndex) <= 1) adjacentPenalty = Math.max(adjacentPenalty, 0.08);
          });
          const mmr = 0.82 * relevance - 0.18 * redundancy - adjacentPenalty;
          if (mmr > bestScore) {
            bestScore = mmr;
            bestIndex = i;
          }
        }
        selected.push(pool.splice(bestIndex, 1)[0]);
      }
      return selected;
    }

    async function rankDocumentChunksHybrid(documents, query, placeholder) {
      const lexical = rankDocumentChunks(documents, query);
      if (documentEmbeddingsDisabledForSession) return { items: lexical, method: "bm25" };
      try {
        for (let i = 0; i < documents.length; i++) {
          updateDocumentEmbeddingStatus(`Preparing local semantic index… ${i + 1}/${documents.length}`);
          await ensureDocumentEmbeddings(documents[i], placeholder);
        }
        if (activeRequestController?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
        updateDocumentEmbeddingStatus("Matching document meaning locally…");
        const queryEmbedding = (await embedDocumentTexts([String(query || "").slice(0, 1600)], placeholder))[0];
        if (!queryEmbedding?.length) throw new Error("Embedding model returned no query vector");

        const semantic = documents.flatMap(workspaceDocument => workspaceDocument.chunks.map((chunk, chunkIndex) => {
          const embedding = workspaceDocument.chunkEmbeddings?.[chunkIndex];
          const semanticScore = Math.max(0, cosineWithStoredEmbedding(queryEmbedding, embedding));
          return { workspaceDocument, chunk, chunkIndex, embedding, semanticScore, score: semanticScore };
        })).sort((a, b) => b.semanticScore - a.semanticScore);

        const fused = fuseDocumentRanks(lexical, semantic).map(item => ({
          ...item,
          embedding: item.workspaceDocument.chunkEmbeddings?.[item.chunkIndex],
          score: item.hybridScore
        }));
        return { items: diversifyDocumentResults(fused), method: "hybrid" };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        console.warn("Hybrid document retrieval unavailable; falling back to BM25:", error);
        documentEmbeddingsDisabledForSession = true;
        return { items: lexical, method: "bm25" };
      } finally {
        documentEmbeddingProgressPlaceholder = null;
      }
    }
'''

if old_rank not in text:
    raise SystemExit('rankDocumentChunks anchor not found')
text = text.replace(old_rank, new_rank, 1)

old_retrieval = r'''      } else {
        mode = "retrieval";
        selected = rankDocumentChunks(documents, query).filter(item => item.score > 0);
        if (!selected.length) selected = rankDocumentChunks(documents, query).slice(0, 2);
      }
'''
new_retrieval = r'''      } else {
        mode = "retrieval";
        const ranking = await rankDocumentChunksHybrid(documents, query, placeholder);
        retrievalMethod = ranking.method;
        selected = ranking.items.filter(item => item.score > 0 || item.lexicalScore > 0 || item.semanticScore > 0);
        if (!selected.length) selected = ranking.items.slice(0, 2);
      }
'''
if old_retrieval not in text:
    raise SystemExit('prepareDocumentContext retrieval anchor not found')
text = text.replace(old_retrieval, new_retrieval, 1)

old_mode_init = r'''      let selected = [];
      let mode = "direct";
'''
new_mode_init = r'''      let selected = [];
      let mode = "direct";
      let retrievalMethod = "none";
'''
if old_mode_init not in text:
    raise SystemExit('prepareDocumentContext mode anchor not found')
text = text.replace(old_mode_init, new_mode_init, 1)

old_processing = r'''Processing mode: ${mode}.\n\n${included.join("\n\n")}\n== END UNTRUSTED DOCUMENT WORKSPACE ==`;
      return { block: instructions, citations, mode };
'''
new_processing = r'''Processing mode: ${mode}${mode === "retrieval" ? ` (${retrievalMethod === "hybrid" ? "local BM25 + semantic fusion" : "local BM25 fallback"})` : ""}.\n\n${included.join("\n\n")}\n== END UNTRUSTED DOCUMENT WORKSPACE ==`;
      return { block: instructions, citations, mode, retrievalMethod };
'''
if old_processing not in text:
    raise SystemExit('processing mode anchor not found')
text = text.replace(old_processing, new_processing, 1)

old_branch_payload = r'''        const payload = { name: source.name, type: source.type, size: source.size, fullText: source.fullText, chunks: source.chunks, tokenEstimate: source.tokenEstimate };
'''
new_branch_payload = r'''        const payload = {
          name: source.name,
          type: source.type,
          size: source.size,
          fullText: source.fullText,
          chunks: source.chunks,
          tokenEstimate: source.tokenEstimate,
          embeddingModel: source.embeddingModel,
          embeddingVersion: source.embeddingVersion,
          chunkEmbeddings: source.chunkEmbeddings
        };
'''
if old_branch_payload not in text:
    raise SystemExit('branch document payload anchor not found')
text = text.replace(old_branch_payload, new_branch_payload, 1)

path.write_text(text, encoding='utf-8')
print('Hybrid retrieval patch applied')
