/** Number formatting shared by the HUD and map labels. */

/** 950 → "950", 12_400 → "12.4K", 1_250_000 → "1.25M". Always the real number, rounded. */
export function formatTroops(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return String(Math.round(value));
  if (abs < 10_000) return `${trim((value / 1_000).toFixed(2))}K`;
  if (abs < 1_000_000) return `${trim((value / 1_000).toFixed(1))}K`;
  return `${trim((value / 1_000_000).toFixed(2))}M`;
}

/** 0.1834 → "18.3%". */
export function formatPercent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function trim(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
