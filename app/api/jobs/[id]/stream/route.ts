import { NextRequest } from "next/server";
import { container } from "@/lib/container";
import { errorResponse } from "@/lib/facade/http";
import { JobNotFound } from "@/lib/errors/errors";
import { encodeSse, type IngestionEvent } from "@/lib/stream/events";

export const runtime = "nodejs";

/** SSE ingestion progress: replays current state, then live events until job-done. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const job = await facade.getJob(userId, id);
    if (!job) throw new JobNotFound(id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (event: IngestionEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(encodeSse(event)));
          } catch {
            closed = true;
          }
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const unsubscribe = facade.subscribeJob(id, (event) => {
          send(event);
          if (event.type === "job-done") finish();
        });

        // initial snapshot
        send({ type: "job-status", jobId: job.id, status: job.status });
        if (job.status === "done") {
          send({ type: "doc-indexed", jobId: job.id, documentId: job.documentId, chunks: job.chunks ?? 0 });
          send({ type: "job-done", jobId: job.id });
          finish();
        } else if (job.status === "error") {
          send({ type: "doc-error", jobId: job.id, documentId: job.documentId, reason: job.error ?? "unknown error" });
          send({ type: "job-done", jobId: job.id });
          finish();
        }

        req.signal.addEventListener("abort", finish, { once: true });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
