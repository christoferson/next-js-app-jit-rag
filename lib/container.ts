// Composition root — the only place concrete impls are wired together.
// Singleton across HMR reloads (in-process job queue + observers must survive
// Next.js dev recompiles), via globalThis stash.
import { FileNotebookRepository } from "./repositories/file-notebook-repository";
import { FileDocumentRepository } from "./repositories/file-document-repository";
import { FileJobRepository } from "./repositories/file-job-repository";
import { LocalDiskUploader } from "./adapters/local-disk-uploader";
import { LanceDBVectorStore } from "./adapters/lancedb-vector-store";
import { BedrockEmbeddingAdapter } from "./adapters/bedrock-embedding-adapter";
import { BedrockLLMAdapter } from "./adapters/bedrock-llm-adapter";
import { StubAuthProvider } from "./adapters/stub-auth-provider";
import type { AuthProvider } from "./adapters/auth-provider";
import { InProcessIngestionQueue } from "./jobs/ingestion-queue";
import { JobService } from "./services/job-service";
import { EmbeddingService } from "./services/embedding-service";
import { ChunkingService } from "./services/chunking-service";
import { IngestionService } from "./services/ingestion-service";
import { NotebookService } from "./services/notebook-service";
import { QueryService } from "./services/query-service";
import { NotebookFacade } from "./facade/notebook-facade";

interface Container {
  facade: NotebookFacade;
  auth: AuthProvider;
}

function build(): Container {
  const notebooks = new FileNotebookRepository();
  const documents = new FileDocumentRepository();
  const jobs = new FileJobRepository();
  const uploader = new LocalDiskUploader();
  const vectors = new LanceDBVectorStore();
  const embeddingAdapter = new BedrockEmbeddingAdapter();
  const llmAdapter = new BedrockLLMAdapter();
  const queue = new InProcessIngestionQueue(2);

  const jobService = new JobService(jobs);
  const embeddingService = new EmbeddingService(embeddingAdapter);
  const chunkingService = new ChunkingService();
  const ingestionService = new IngestionService(documents, uploader, vectors, chunkingService, embeddingService, jobService);
  const notebookService = new NotebookService(notebooks, documents, vectors, uploader);
  const queryService = new QueryService(vectors, embeddingService, llmAdapter, documents);

  const facade = new NotebookFacade(
    notebookService,
    ingestionService,
    chunkingService,
    jobService,
    queryService,
    documents,
    uploader,
    vectors,
    queue
  );
  return { facade, auth: new StubAuthProvider() };
}

const globalStore = globalThis as unknown as { __notebookContainer?: Container };

export function container(): Container {
  if (!globalStore.__notebookContainer) {
    globalStore.__notebookContainer = build();
  }
  return globalStore.__notebookContainer;
}
