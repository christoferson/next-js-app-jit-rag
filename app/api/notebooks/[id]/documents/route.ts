import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { container } from "@/lib/container";
import { errorResponse } from "@/lib/facade/http";

export const runtime = "nodejs";

const fieldsSchema = z.object({
  chunkingMode: z.enum(["auto", "custom"]).default("auto"),
  strategyId: z.string().optional(),
  strategyConfig: z.unknown().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { facade, auth } = container();
    const { userId } = await auth.currentUser();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "multipart field 'file' is required" } },
        { status: 400 }
      );
    }
    let strategyConfig: unknown;
    const rawConfig = form.get("strategyConfig");
    if (typeof rawConfig === "string" && rawConfig.length > 0) {
      try {
        strategyConfig = JSON.parse(rawConfig);
      } catch {
        strategyConfig = undefined; // malformed config JSON → strategy defaults
      }
    }
    const fields = fieldsSchema.parse({
      chunkingMode: form.get("chunkingMode") ?? undefined,
      strategyId: form.get("strategyId") ?? undefined,
      strategyConfig,
    });

    const data = Buffer.from(await file.arrayBuffer());
    const result = await facade.ingestDocument(userId, id, {
      fileName: file.name,
      data,
      chunkingMode: fields.chunkingMode,
      strategyId: fields.strategyId,
      strategyConfig: fields.strategyConfig,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, { status: 400 });
    }
    return errorResponse(err);
  }
}
