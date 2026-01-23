/**
 * Shared tokenizer utilities for parsing DSL strings.
 * Handles quoted values like "stage: QA" that contain spaces or colons.
 */

/**
 * Tokenize a DSL string, respecting quoted values.
 * Splits by whitespace BUT preserves quoted strings.
 *
 * @example tokenizeString('state:open label:bug') -> ['state:open', 'label:bug']
 * @example tokenizeString('label:"stage: QA"') -> ['label:"stage: QA"']
 * @example tokenizeString('close add-label:"has spaces"') -> ['close', 'add-label:"has spaces"']
 */
export function tokenizeString(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of input.trim()) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

/**
 * Strip surrounding double quotes from a value if present.
 *
 * @example stripQuotes('"stage: QA"') -> 'stage: QA'
 * @example stripQuotes('bug') -> 'bug'
 */
export function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
