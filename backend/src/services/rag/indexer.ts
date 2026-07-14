/**
 * Doc corpus RAG indexer for the chat surface.
 *
 * Chat already knows how to look up structured entities via chat-tools
 * (users, services, changes, etc). What it couldn't do until now is
 * quote Sentinel's own architecture: the ontology docs, the skill
 * specs, the design decisions. This indexer builds a small in-memory
 * vector store over that markdown corpus so a `lookup_docs` tool can
 * ground answers about the system itself.
 *
 * Design choices:
 *   - `MemoryVectorStore`: no external DB. Rebuilds per process, cheap
 *     to keep hot. Suitable for personal-project scope; swap for
 *     pgvector or Chroma when the corpus grows past a few hundred docs.
 *   - `HuggingFaceTransformersEmbeddings` (Xenova/all-MiniLM-L6-v2):
 *     local ONNX embeddings. No embedding API key needed — one 120MB
 *     model download on first boot cached under `~/.cache/huggingface`.
 *     Trade-off vs OpenAI/Voyage embeddings: quality is lower but cost
 *     is zero and there's no third-party call, which matches the "no
 *     silent egress" posture used elsewhere in Sentinel.
 *   - `RecursiveCharacterTextSplitter`: 800-char chunks with 100-char
 *     overlap. Matches the general shape of the docs (short markdown
 *     sections) without splitting mid-sentence too often.
 *
 * Lazy singleton: retriever is built on first call so `server.ts` can
 * warm it during boot without blocking route registration. Concurrent
 * warm-up calls dedupe on the in-flight promise.
 */

import { readFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/huggingface_transformers'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'

const REPO_ROOT = resolve(process.cwd(), '..')
const DOC_GLOBS = [
  'docs/**/*.md',
  'skills/**/skill.md',
]
const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 100
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'

let retrieverPromise: Promise<MemoryVectorStore> | null = null

async function collectDocPaths(root: string): Promise<string[]> {
  const seen = new Set<string>()
  for (const pattern of DOC_GLOBS) {
    for await (const entry of glob(pattern, { cwd: root })) {
      const abs = resolve(root, entry as string)
      seen.add(abs)
    }
  }
  return [...seen]
}

async function loadCorpus(root: string): Promise<Document[]> {
  const paths = await collectDocPaths(root)
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  })

  const docs: Document[] = []
  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf8')
      const rel = relative(root, path).replace(/\\/g, '/')
      const chunks = await splitter.createDocuments(
        [raw],
        // Metadata lands on every chunk so retrieval results can cite
        // the source path back to the user.
        [{ source: rel }],
      )
      docs.push(...chunks)
    } catch (err) {
      // Missing / unreadable file → log and continue. Corpus is
      // best-effort; one bad file shouldn't break retrieval.
      // eslint-disable-next-line no-console
      console.warn('[rag] skipping doc:', path, err)
    }
  }
  return docs
}

async function buildRetriever(): Promise<MemoryVectorStore> {
  // eslint-disable-next-line no-console
  console.log('[rag] indexing doc corpus…')
  const started = Date.now()
  const embeddings = new HuggingFaceTransformersEmbeddings({
    model: EMBED_MODEL,
  })
  const docs = await loadCorpus(REPO_ROOT)
  const store = await MemoryVectorStore.fromDocuments(docs, embeddings)
  // eslint-disable-next-line no-console
  console.log(
    `[rag] indexed ${docs.length} chunks in ${Date.now() - started}ms`,
  )
  return store
}

/**
 * Return the singleton retriever, building it on first call. Callers
 * can safely await this multiple times — the promise is memoized.
 */
export function getDocRetriever(): Promise<MemoryVectorStore> {
  if (!retrieverPromise) {
    retrieverPromise = buildRetriever().catch((err) => {
      // Reset so a subsequent call can retry (eg after a transient
      // model-download failure) instead of returning the failed promise
      // forever.
      retrieverPromise = null
      throw err
    })
  }
  return retrieverPromise
}

/**
 * Search the doc corpus. Used by the `lookup_docs` chat tool. Returns
 * top-k hits with source path, snippet, and cosine similarity score.
 */
export async function searchDocs(
  query: string,
  k = 4,
): Promise<Array<{ path: string; snippet: string; score: number }>> {
  const store = await getDocRetriever()
  const hits = await store.similaritySearchWithScore(query, k)
  return hits.map(([doc, score]) => ({
    path: (doc.metadata.source as string) ?? 'unknown',
    snippet: doc.pageContent.slice(0, 500),
    score,
  }))
}
