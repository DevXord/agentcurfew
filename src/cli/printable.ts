/** Text from files or arguments can hold escape sequences and invisible characters, which must not reach the terminal. */
export function printable(text: string): string {
  return text.replace(/\p{C}/gu, '?');
}

/** JSON with such characters written as \u escapes, so that the output means the same and shows no hidden text. */
export function printableJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\p{C}/gu, (char) => {
    if (char === '\n') return char;
    let escaped = '';
    for (let index = 0; index < char.length; index++) escaped += `\\u${char.charCodeAt(index).toString(16).padStart(4, '0')}`;
    return escaped;
  });
}
