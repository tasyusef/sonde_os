export interface ThisMonth {
  totalQueries: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface ByQueryType {
  queryType: string;
  count: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgTokensIn: number;
  avgTokensOut: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

export interface ByModel {
  model: string | null;
  count: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export interface DailyPoint {
  date: string;
  queries: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiUsageData {
  thisMonth: ThisMonth;
  byQueryType: ByQueryType[];
  byModel: ByModel[];
  daily: DailyPoint[];
}
