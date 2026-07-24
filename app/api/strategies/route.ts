import { NextRequest, NextResponse } from "next/server";
import { CHUNKING_STRATEGIES, DEFAULT_STRATEGY_BY_TYPE } from "@/lib/chunking/registry";

export const runtime = "nodejs";

/** Client-safe strategy registry. With ?fileType=, only applicable strategies. */
export async function GET(req: NextRequest) {
  const fileType = req.nextUrl.searchParams.get("fileType")?.toLowerCase() ?? null;
  const strategies = (fileType ? CHUNKING_STRATEGIES.filter((s) => s.applicableTo(fileType)) : CHUNKING_STRATEGIES).map(
    (s) => ({
      id: s.id,
      displayName: s.displayName,
      description: s.description,
      configSchema: s.configSchema(),
    })
  );
  return NextResponse.json({
    strategies,
    defaultForType: fileType ? (DEFAULT_STRATEGY_BY_TYPE[fileType] ?? null) : DEFAULT_STRATEGY_BY_TYPE,
  });
}
