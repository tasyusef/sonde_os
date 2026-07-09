/**
 * Analytics queries — barrel re-export.
 * All existing imports from "@/lib/analytics-queries" continue to work.
 */

export { type Period, VALID_PERIODS } from "./core";

export {
  getFeeBurnTimeSeries,
  getFeeBurnTotal,
  getTxVolumeTimeSeries,
  getTxVolumeStats,
  getDexVolumeTimeSeries,
  getDexVolumeTotal,
  getDexVolume7dChange,
  getNFTActivityTimeSeries,
  getNFTActivityTotal,
} from "./volume";

export {
  getPaymentCorridors,
  getCorridorStats,
  getTopTraders,
  getActiveWalletsTimeSeries,
  getActiveWalletsTotal,
  getNetworkGrowthStats,
  getTokenVelocity,
} from "./network";

export {
  getTopTokenMovers,
  getAMMFeeRevenue,
  getCumulativeBurnTimeSeries,
} from "./market";
