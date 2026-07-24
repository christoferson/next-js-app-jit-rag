import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { container } from "@/lib/container";
import { errorResponse } from "@/lib/facade/http";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  embeddingModelId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const body = createSchema.parse(await req.json());
    const notebook = await facade.createNotebook(userId, body.name, body.embeddingModelId);
    return NextResponse.json(
      {
        id: notebook.id,
        name: notebook.name,
        embeddingModelId: notebook.embeddingModelId,
        dim: notebook.dim,
        createdAt: notebook.createdAt,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, { status: 400 });
    }
    return errorResponse(err);
  }
}

export async function GET() {
  try {
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();
    const notebooks = await facade.listNotebooks(userId);
    return NextResponse.json(
      notebooks.map((n) => ({ id: n.id, name: n.name, docCount: n.docCount, createdAt: n.createdAt }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}
