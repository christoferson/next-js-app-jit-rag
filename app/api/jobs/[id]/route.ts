import { NextRequest, NextResponse } from "next/server";
import { container } from "@/lib/container";
import { errorResponse } from "@/lib/facade/http";
import { JobNotFound } from "@/lib/errors/errors";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const job = await facade.getJob(userId, id);
    if (!job) throw new JobNotFound(id);
    return NextResponse.json({
      id: job.id,
      documentId: job.documentId,
      status: job.status,
      phase: job.phase,
      processed: job.processed,
      total: job.total,
      chunks: job.chunks,
      error: job.error,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
