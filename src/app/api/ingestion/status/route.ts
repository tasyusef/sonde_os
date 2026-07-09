import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { ingestionManager } from "@/lib/ingestion";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession(await cookies());
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await ingestionManager.getStatus();
    return NextResponse.json(status);
  } catch (err) {
    logger.error({ err }, "[api/ingestion/status] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
