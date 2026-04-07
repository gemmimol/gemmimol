export function tokenize_cif_row(line: string): string[] {
  const tokens = line.match(/'(?:[^']*)'|"(?:[^"]*)"|\S+/g);
  if (tokens == null) return [];
  return tokens.map((token) => {
    if ((token.startsWith('\'') && token.endsWith('\'')) ||
        (token.startsWith('"') && token.endsWith('"'))) {
      return token.slice(1, -1);
    }
    return token;
  });
}
