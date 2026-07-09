import { NextResponse, type NextRequest } from "next/server";
import { computeGraphFeatures, type GraphFeatures } from "@/lib/intel-graph-features";
import { computeBehavioralFeatures, type BehavioralFeatures } from "@/lib/intel-behavioral-features";
import { detectWashPatterns, type WashFlag } from "@/lib/intel-wash-detection";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-risk", 20);

interface RiskFactors {
  /** Wash trading flags contribute heavily to risk */
  washPatterns: number;
  /** Very low counterparty diversity */
  lowDiversity: number;
  /** Extremely high transaction frequency (potential bot) */
  highFrequency: number;
  /** Activity concentrated in a few hours (bot-like) */
  lowEntropy: number;
  /** Circular payment patterns */
  circularPayments: number;
}

function computeRiskScore(
  graph: GraphFeatures | null,
  behavioral: BehavioralFeatures | null,
  flags: WashFlag[],
): { score: number; factors: RiskFactors } {
  const factors: RiskFactors = {
    washPatterns: 0,
    lowDiversity: 0,
    highFrequency: 0,
    lowEntropy: 0,
    circularPayments: 0,
  };

  // Wash pattern flags (max 40 points)
  for (const flag of flags) {
    if (flag.pattern === "circular_payments") {
      factors.circularPayments = Math.round(flag.confidence * 25);
    }
    if (flag.pattern === "rapid_pair_trading") {
      factors.washPatterns = Math.round(flag.confidence * 15);
    }
    if (flag.pattern === "low_diversity") {
      factors.lowDiversity = Math.round(flag.confidence * 15);
    }
  }

  // Graph features (max 20 points)
  if (graph) {
    // Very few counterparties relative to transactions
    if (graph.degree > 20 && graph.uniqueCounterparties <= 3) {
      factors.lowDiversity = Math.max(factors.lowDiversity, 15);
    }
    // Extreme in/out ratio imbalance
    if (graph.inOutRatio != null && (graph.inOutRatio > 10 || (graph.inOutRatio > 0 && graph.inOutRatio < 0.1))) {
      factors.lowDiversity = Math.min(20, factors.lowDiversity + 5);
    }
  }

  // Behavioral features (max 40 points)
  if (behavioral) {
    // Very high transaction frequency (> 100/day)
    if (behavioral.avgTxPerDay > 100) {
      factors.highFrequency = 20;
    } else if (behavioral.avgTxPerDay > 50) {
      factors.highFrequency = 10;
    }

    // Low hour entropy (< 2.0 out of max ~4.58 for 24 bins)
    if (behavioral.hourEntropy < 1.5 && behavioral.txCount > 20) {
      factors.lowEntropy = 15;
    } else if (behavioral.hourEntropy < 2.5 && behavioral.txCount > 20) {
      factors.lowEntropy = 5;
    }

    // Very high burst (> 100 tx in one hour)
    if (behavioral.maxTxPerHour > 100) {
      factors.highFrequency = Math.max(factors.highFrequency, 15);
    }
  }

  const score = Math.min(
    100,
    factors.washPatterns +
      factors.lowDiversity +
      factors.highFrequency +
      factors.lowEntropy +
      factors.circularPayments,
  );

  return { score, factors };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const account = request.nextUrl.searchParams.get("account");

  if (!account || !XRPL_ADDRESS_RE.test(account)) {
    return NextResponse.json({ error: "Valid account address required" }, { status: 400 });
  }

  // Run all analyses in parallel
  const [graphFeatures, behavioralFeatures, washFlags] = await Promise.all([
    computeGraphFeatures(account).catch(() => null),
    computeBehavioralFeatures(account).catch(() => null),
    detectWashPatterns(account).catch(() => []),
  ]);

  const { score, factors } = computeRiskScore(graphFeatures, behavioralFeatures, washFlags);

  const riskLevel =
    score >= 60 ? "high" : score >= 30 ? "medium" : score > 0 ? "low" : "none";

  return NextResponse.json({
    account,
    riskScore: score,
    riskLevel,
    factors,
    graphFeatures,
    behavioralFeatures,
    washFlags,
  });
}
