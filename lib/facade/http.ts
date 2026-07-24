// Route-layer helpers: AppError → HTTP JSON, and typed-event → SSE Response.
import { NextResponse } from "next/server";
import { toReadable } from "../errors/errors";
import { encodeSse, type StreamEvent } from "../stream/events";

export function errorResponse(err: unknown): NextResponse {
  const { code, message, httpStatus } = toReadable(err);
  if (httpStatus >= 500) console.error("[api]", err);
  return NextResponse.json({ error: { code, message } }, { status: httpStatus });
}

/** Streams typed events as SSE. The generator is driven until done or client abort. */
export function sseResponse(events: AsyncGenerator<StreamEvent>, signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeSse(event)));
          if (signal?.aborted) break;
        }
      } catch (err) {
        const { code, message } = toReadable(err);
        try {
          controller.enqueue(encoder.encode(encodeSse({ type: "error", code, message })));
        } catch {
          // stream already closed
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // client disconnected; generator GC'd, abort propagated via `signal` by the route
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
