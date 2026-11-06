/** A secret as it may be printed: the first four characters and its length. */
export function maskSecret(secret: string): string {
  const chars = [...secret];
  return `${chars.slice(0, 4).join('')}… (${chars.length} characters)`;
}

/** Text that came from a scanned file, made safe to print in a message: no control or invisible characters, bounded. */
export function quote(text: string, max = 60): string {
  const clean = text.replace(/\p{C}/gu, '?');
  const chars = [...clean];
  return chars.length <= max ? clean : `${chars.slice(0, max).join('')}…`;
}
