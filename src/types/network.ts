export interface ServerHealth {
  buildVersion: string;
  loadFactor: number;
  serverState: string;
  quorum: number;
  completeLedgers: string;
  validatedSeq: number;
}

/** All fee fields are in drops (1 XRP = 1,000,000 drops). Use dropsToXrp() for display. */
export interface FeeInfo {
  baseFeeDrops: string;
  medianFeeDrops: string;
  minimumFeeDrops: string;
  openLedgerFeeDrops: string;
  queueSize: number;
  expectedLedgerSize: number;
  maxQueueSize: number;
}

export interface TxTypeDistribution {
  family: string;
  count: number;
  percentage: number;
  color: string;
}
