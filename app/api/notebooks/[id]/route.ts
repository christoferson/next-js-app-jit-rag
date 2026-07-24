import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { container } from "@/lib/container";
import { errorResponse } from "@/lib/facade/http";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const overview = await facade.openNotebook(userId, id);
    return NextResponse.json({
      notebook: {
        id: overview.notebook.id,
        name: overview.notebook.name,
        embeddingModelId: overview.notebook.embeddingModelId,
        dim: overview.notebook.dim,
        createdAt: overview.notebook.createdAt,
      },
      documents: overview.documents.map((d) => ({
        id: d.id,
        name: d.name,
        fileType: d.fileType,
        sizeBytes: d.sizeBytes,
        strategyId: d.strategyId,
        strategyConfig: d.strategyConfig,
        status: d.status,
        chunkCount: d.chunkCount,
        error: d.error,
        createdAt: d.createdAt,
      })),
      totals: overview.totals,
      embeddingModel: overview.embeddingModel,
      llmDefault: overview.llmDefault,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  embeddingModelId: z.string().min(1).optional(),
});

/** Rename / change embedding model (rejected with ModelLocked once documents exist). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const body = patchSchema.parse(await req.json());
    const notebook = await facade.updateNotebook(userId, id, body);
    return NextResponse.json({
      id: notebook.id,
      name: notebook.name,
      embeddingModelId: notebook.embeddingModelId,
      dim: notebook.dim,
      createdAt: notebook.createdAt,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, { status: 400 });
    }
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    await facade.deleteNotebook(userId, id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
