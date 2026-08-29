export interface GoalProjectionInput {
  startingMinor: number;
  targetMinor: number;
  monthlySetAsideMinor: number;
  reductionBps: number;
  typicalOutgoingMinor: number | null;
}

export interface GoalProjection {
  remainingMinor: number;
  additionalKeptMinor: number;
  monthlyProgressMinor: number;
  monthsToGoal: number | null;
  baselineMonthsToGoal: number | null;
  projectedAfterYearMinor: number;
  baselineAfterYearMinor: number;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function roundDivide(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("denominator must be positive");
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function monthsFor(remainingMinor: number, monthlyProgressMinor: number): number | null {
  if (remainingMinor <= 0) return 0;
  if (monthlyProgressMinor <= 0) return null;
  return Math.ceil(remainingMinor / monthlyProgressMinor);
}

/**
 * Linear, integer-poisha projection. It models no interest, fees, returns, or
 * future Transfers. The same small interface drives the UI and its verification.
 */
export function calculateGoalProjection(input: GoalProjectionInput): GoalProjection {
  const startingMinor = clampInteger(input.startingMinor, 0, Number.MAX_SAFE_INTEGER);
  const targetMinor = clampInteger(input.targetMinor, 0, Number.MAX_SAFE_INTEGER);
  const monthlySetAsideMinor = clampInteger(
    input.monthlySetAsideMinor,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const reductionBps = clampInteger(input.reductionBps, 0, 10_000);
  const typicalOutgoingMinor = input.typicalOutgoingMinor === null
    ? 0
    : clampInteger(input.typicalOutgoingMinor, 0, Number.MAX_SAFE_INTEGER);

  const additionalKeptMinor = roundDivide(typicalOutgoingMinor * reductionBps, 10_000);
  const monthlyProgressMinor = monthlySetAsideMinor + additionalKeptMinor;
  const remainingMinor = Math.max(targetMinor - startingMinor, 0);

  return {
    remainingMinor,
    additionalKeptMinor,
    monthlyProgressMinor,
    monthsToGoal: monthsFor(remainingMinor, monthlyProgressMinor),
    baselineMonthsToGoal: monthsFor(remainingMinor, monthlySetAsideMinor),
    projectedAfterYearMinor: startingMinor + monthlyProgressMinor * 12,
    baselineAfterYearMinor: startingMinor + monthlySetAsideMinor * 12,
  };
}
