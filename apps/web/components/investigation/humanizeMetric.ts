const UPPER_ACRONYMS = new Set(["upi"]);

/** "upi_share_of_failures" -> "UPI share of failures" */
export function humanizeMetric(metric: string): string {
  return metric
    .split("_")
    .map((word, index) => {
      if (UPPER_ACRONYMS.has(word)) return word.toUpperCase();
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}
