/** Uploader seam — local disk now, presigned-S3/multipart later. */
export interface Uploader {
  /** Stores the file, returns a storage path usable with read(). */
  store(userId: string, notebookId: string, fileName: string, data: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
}
