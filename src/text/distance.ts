/** Edit distance between two strings, bounded: past `max` it stops counting and returns max + 1. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

/** The closest candidate within a distance that grows with the length of the input, or undefined. */
export function closest(input: string, candidates: readonly string[]): string | undefined {
  const max = Math.max(2, Math.min(3, Math.floor(input.length / 3)));
  let best: { candidate: string; score: number } | undefined;
  for (const candidate of candidates) {
    const score = distance(input.toLowerCase(), candidate.toLowerCase(), max);
    if (score <= max && (best === undefined || score < best.score)) best = { candidate, score };
  }
  return best?.candidate;
}
