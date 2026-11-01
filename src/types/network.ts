export interface ServerHealth {
  buildVersion: string;
  loadFactor: number;
  serverState: string;
  quorum: number;
  completeLedgers: string;
  validatedSeq: number;
}
