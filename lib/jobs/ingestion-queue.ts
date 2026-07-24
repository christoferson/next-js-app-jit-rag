// IngestionQueue seam — in-process async task runner now; SQS/Step Functions later.
// Concurrency-limited; a failing task never takes down the runner or a sibling task.

export interface IngestionQueue {
  /** fire-and-forget; the task's own error handling decides what failure means */
  enqueue(task: () => Promise<void>): void;
}

export class InProcessIngestionQueue implements IngestionQueue {
  private running = 0;
  private pending: (() => Promise<void>)[] = [];

  constructor(private readonly concurrency = 2) {}

  enqueue(task: () => Promise<void>): void {
    this.pending.push(task);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      this.running++;
      task()
        .catch((err) => {
          // tasks are expected to record their own failures; this is the last-resort guard
          console.error("[ingestion-queue] task threw uncaught:", err);
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
