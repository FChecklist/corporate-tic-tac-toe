export interface PlannedPrize { id: string; ticket: number; pattern: string; ordinal: number; label: string; pct: number; amount: number }
export interface PrizePlanResult { tickets: 1 | 2; count: number; budget: number; total: number; prizes: PlannedPrize[] }
export interface ManualPrizeRow { id: string; amount: number; gift?: string }
declare const API: {
  COUNTS: Record<1 | 2, number[]>; DEFAULT_COUNT: Record<1 | 2, number>; MAX_MANUAL: number;
  split(tickets: number, count: number): Omit<PlannedPrize, "amount">[];
  plan(tickets: number, count: number, budget: number): PrizePlanResult;
  shareOut(prizeAmount: number, winners: number): { share: number; leftover: number; winners: number };
  validateManual(prizes: ManualPrizeRow[]): string[];
  hint(plan: PrizePlanResult): string;
  label(pattern: string, ordinal: number, ofTotal: number, ticket: number): string;
};
export default API;
