"use client";

import PnLWaterfall from "@/components/portfolio/PnLWaterfall";
import RiskMetrics from "@/components/portfolio/RiskMetrics";
import ReserveBreakdown from "@/components/portfolio/ReserveBreakdown";
import RealizedPnLChart from "@/components/portfolio/RealizedPnLChart";
import CorrelationMatrix from "@/components/portfolio/CorrelationMatrix";
import LiquidityWarning from "@/components/portfolio/LiquidityWarning";

export default function OverviewBelowFold() {
  return (
    <>
      <PnLWaterfall />
      <RiskMetrics />
      <ReserveBreakdown />
      <RealizedPnLChart />
      <CorrelationMatrix />
      <LiquidityWarning />
    </>
  );
}
