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

/** An amendment's votes among the validators on the default UNL. */
export interface AmendmentVotes {
  yes: number;
  /** Validators on the UNL. */
  of: number;
  /** Yes votes it needs to hold a majority. */
  needed: number;
}

/** Processed amendment info for the UI */
export interface AmendmentInfo {
  hash: string;
  name: string;
  enabled: boolean;
  enabledAt: string | null;
  /** Holds a majority now: two weeks of it activates the amendment. */
  hasMajority: boolean;
  /** When the majority it holds activates it (ISO). */
  activatesAt: string | null;
  /** Null when no source reports votes. */
  votes: AmendmentVotes | null;
}
