// Turns a current value + a set of comparable baseline values into the
// change statistics every detector reports (Phase 4 brief section 7):
// current/baseline/absolute/relative change, sample size, and — where
// there's more than one baseline window — its min/max/count.

export interface BaselineComparison {
  baselineValue: number;
  baselineMin: number;
  baselineMax: number;
  absoluteChange: number;
  relativeChange: number | null;
  comparisonWindows: number;
}

/** `baselineValue` is the mean of the per-window baseline readings — the
 * simplest honest summary of "what's normal for this time of day", not a
 * forecast. Every detector treats this the same way; only what feeds the
 * per-window values differs between detectors. */
export function compareToBaseline(
  currentValue: number,
  baselineValues: number[],
): BaselineComparison {
  const comparisonWindows = baselineValues.length;
  const baselineValue =
    comparisonWindows > 0 ? baselineValues.reduce((sum, v) => sum + v, 0) / comparisonWindows : 0;
  const baselineMin = comparisonWindows > 0 ? Math.min(...baselineValues) : 0;
  const baselineMax = comparisonWindows > 0 ? Math.max(...baselineValues) : 0;
  const absoluteChange = currentValue - baselineValue;
  const relativeChange = baselineValue !== 0 ? absoluteChange / baselineValue : null;

  return {
    baselineValue,
    baselineMin,
    baselineMax,
    absoluteChange,
    relativeChange,
    comparisonWindows,
  };
}
