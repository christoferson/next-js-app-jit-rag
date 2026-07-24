import type { Job, JobRepository } from "./types";
import { JobNotFound } from "../errors/errors";
import { jobPath, readJson, withFileLock, writeJsonAtomic } from "./fs-util";

export class FileJobRepository implements JobRepository {
  async save(job: Job): Promise<void> {
    const file = jobPath(job.userId, job.id);
    await withFileLock(file, () => writeJsonAtomic(file, job));
  }

  async findById(userId: string, id: string): Promise<Job | null> {
    return readJson<Job>(jobPath(userId, id));
  }

  async update(userId: string, id: string, mutate: (job: Job) => Job): Promise<Job> {
    const file = jobPath(userId, id);
    return withFileLock(file, async () => {
      const current = await readJson<Job>(file);
      if (!current) throw new JobNotFound(id);
      const next = { ...mutate(current), updatedAt: new Date().toISOString() };
      await writeJsonAtomic(file, next);
      return next;
    });
  }
}
