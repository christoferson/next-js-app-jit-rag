// JobService — async job registry + progress (Observer/callbacks). Progress is persisted
// (atomic) so polling GET /api/jobs/[id] always sees a valid snapshot; observers feed SSE.
import type { Job, JobRepository } from "../repositories/types";
import type { IngestionEvent, JobPhase } from "../stream/events";

export type JobObserver = (event: IngestionEvent) => void;

export class JobService {
  private observers = new Map<string, Set<JobObserver>>();

  constructor(private readonly jobs: JobRepository) {}

  async create(userId: string, notebookId: string, documentId: string, jobId: string): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: jobId,
      userId,
      notebookId,
      documentId,
      status: "queued",
      phase: "queued",
      processed: 0,
      total: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.save(job);
    return job;
  }

  async get(userId: string, jobId: string): Promise<Job | null> {
    return this.jobs.findById(userId, jobId);
  }

  subscribe(jobId: string, observer: JobObserver): () => void {
    let set = this.observers.get(jobId);
    if (!set) {
      set = new Set();
      this.observers.set(jobId, set);
    }
    set.add(observer);
    return () => {
      set!.delete(observer);
      if (set!.size === 0) this.observers.delete(jobId);
    };
  }

  private emit(jobId: string, event: IngestionEvent): void {
    for (const observer of this.observers.get(jobId) ?? []) {
      try {
        observer(event);
      } catch {
        // an observer must never break the pipeline
      }
    }
  }

  async progress(
    userId: string,
    jobId: string,
    phase: JobPhase,
    extra?: { processed?: number; total?: number }
  ): Promise<void> {
    const job = await this.jobs.update(userId, jobId, (j) => ({
      ...j,
      status: "running",
      phase,
      processed: extra?.processed ?? j.processed,
      total: extra?.total ?? j.total,
    }));
    this.emit(jobId, {
      type: "file-progress",
      jobId,
      documentId: job.documentId,
      phase,
      processed: job.processed,
      total: job.total,
    });
  }

  async completed(userId: string, jobId: string, chunks: number): Promise<void> {
    const job = await this.jobs.update(userId, jobId, (j) => ({
      ...j,
      status: "done",
      phase: "done",
      chunks,
    }));
    this.emit(jobId, { type: "doc-indexed", jobId, documentId: job.documentId, chunks });
    this.emit(jobId, { type: "job-done", jobId });
  }

  async failed(userId: string, jobId: string, reason: string): Promise<void> {
    const job = await this.jobs.update(userId, jobId, (j) => ({
      ...j,
      status: "error",
      phase: "error",
      error: reason,
    }));
    this.emit(jobId, { type: "doc-error", jobId, documentId: job.documentId, reason });
    this.emit(jobId, { type: "job-done", jobId });
  }
}
