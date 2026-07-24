import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { container } from "@/lib/container";
import { errorResponse, sseResponse } from "@/lib/facade/http";

export const runtime = "nodejs";

const querySchema = z.object({
  question: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().min(1).max(20).default(Number(process.env.DEFAULT_TOP_K ?? 5) || 5),
  filter: z.object({ documentId: z.string().optional() }).optional(),
  llmModelId: z.string().optional(),
  temperature: z.coerce.number().min(0).max(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const body = querySchema.parse(await req.json());

    // client abort (Stop button / disconnect) propagates into the Bedrock stream
    const events = facade.query(userId, id, {
      question: body.question,
      topK: body.topK,
      documentId: body.filter?.documentId,
      llmModelId: body.llmModelId,
      temperature: body.temperature,
      signal: req.signal,
    });
    return sseResponse(events, req.signal);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, { status: 400 });
    }
    return errorResponse(err);
  }
}
