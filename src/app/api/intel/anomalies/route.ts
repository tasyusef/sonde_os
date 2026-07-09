import { NextResponse, type NextRequest } from "next/server";
import { detectAnomalies } from "@/lib/anomaly-detection";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-anomalies", 30);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  try {
    const anomalies = await detectAnomalies();
    return NextResponse.json({
      anomalies,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    // Never error visibly — feed should degrade gracefully
    return NextResponse.json({
      anomalies: [],
      checkedAt: new Date().toISOString(),
    });
  }
}
