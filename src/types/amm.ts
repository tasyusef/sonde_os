/** Raw XRPL amm_info response shape */
export interface AMMInfoResult {
  amm: {
    account: string;
    amount: string | { currency: string; issuer: string; value: string };
    amount2: string | { currency: string; issuer: string; value: string };
    lp_token: {
      currency: string;
      issuer: string;
      value: string;
    };
    trading_fee: number; // 0–1000, where 1000 = 1%
    vote_slots?: Array<{
      account: string;
      trading_fee: number;
      vote_weight: number;
    }>;
  };
}

/** Processed AMM position ready for display */
export interface AMMPosition {
  ammAccount: string;
  asset1Label: string;
  asset1IsXrp: boolean;
  asset1Issuer: string;
  asset1Currency: string;
  asset1Value: number;
  asset2Label: string;
  asset2IsXrp: boolean;
  asset2Issuer: string;
  asset2Currency: string;
  asset2Value: number;
  lpTokenBalance: number;
  lpTokenSupply: number;
  sharePercent: number;
  tradingFee: number;
}
