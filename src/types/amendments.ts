/** Raw response from XRPL `feature` command */
export interface FeatureResponse {
  [hash: string]: {
    name: string;
    enabled: boolean;
    supported: boolean;
    vetoed?: boolean;
    count?: number;
    threshold?: number;
    validations?: number;
  };
}

/** Raw Amendments ledger entry shape */
export interface AmendmentsLedgerEntry {
  Amendments?: string[];
  Majorities?: Array<{
    Majority: {
      Amendment: string;
      CloseTime: number;
    };
  }>;
}

/** Processed amendment info for the UI */
export interface AmendmentInfo {
  hash: string;
  name: string;
  enabled: boolean;
  enabledAt: string | null;
  currentYesCount: number;
  threshold: number;
  totalValidators: number;
  hasMajority: boolean;
  majorityPercent: number;
}

/** Single data point for the vote history chart */
export interface AmendmentVotePoint {
  timestamp: number;
  yesCount: number;
  threshold: number;
  totalValidators: number;
  percent: number;
}

/** Summary stats for the amendments page */
export interface AmendmentSummary {
  totalKnown: number;
  enabled: number;
  pending: number;
  withMajority: number;
}
