import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { container } from "@/lib/container";
import { errorResponse } from "@/lib/facade/http";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const { id, docId } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    await facade.deleteDocument(userId, id, docId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}

const reingestSchema = z.object({
  chunkingMode: z.enum(["auto", "custom"]).default("auto"),
  strategyId: z.string().optional(),
  strategyConfig: z.unknown().optional(),
});

/** Re-ingest with a (possibly different) strategy. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  try {
    const { id, docId } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const body = reingestSchema.parse(await req.json().catch(() => ({})));
    const result = await facade.reingestDocument(
      userId,
      id,
      docId,
      body.chunkingMode,
      body.strategyId,
      body.strategyConfig
    );
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, { status: 400 });
    }
    return errorResponse(err);
  }
}
