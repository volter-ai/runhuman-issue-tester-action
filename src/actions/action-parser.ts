/**
 * Parser for the action DSL.
 *
 * DSL syntax:
 * - close: Close the issue
 * - open: Reopen the issue
 * - add-label:bug or add-label:"stage: QA": Add a label
 * - remove-label:bug or remove-label:"stage: QA": Remove a label
 * - comment: Post a comment with details
 *
 * @example 'close add-label:"stage: Released" remove-label:"stage: QA"'
 */

import { tokenizeString, stripQuotes } from '../utils/tokenizer';

export type ActionType = 'close' | 'open' | 'add-label' | 'remove-label' | 'comment';

export interface ParsedAction {
  type: ActionType;
  /** Value for add-label/remove-label */
  value?: string;
}

const VALID_ACTION_TYPES: ActionType[] = ['close', 'open', 'add-label', 'remove-label', 'comment'];

/**
 * Parse an action DSL string into an array of actions.
 *
 * @example parseActions('close') -> [{ type: 'close' }]
 * @example parseActions('add-label:bug') -> [{ type: 'add-label', value: 'bug' }]
 * @example parseActions('close add-label:"stage: QA"')
 *   -> [{ type: 'close' }, { type: 'add-label', value: 'stage: QA' }]
 */
export function parseActions(actionString: string): ParsedAction[] {
  if (!actionString?.trim()) return [];

  const tokens = tokenizeString(actionString);
  const actions: ParsedAction[] = [];

  for (const token of tokens) {
    const colonIndex = token.indexOf(':');

    if (colonIndex === -1) {
      // Simple action: close, open, comment
      const type = token.toLowerCase() as ActionType;
      if (!VALID_ACTION_TYPES.includes(type)) {
        throw new Error(`Unknown action: "${token}". Valid actions: ${VALID_ACTION_TYPES.join(', ')}`);
      }
      actions.push({ type });
    } else {
      // Action with value: add-label:x, remove-label:x
      const type = token.substring(0, colonIndex).toLowerCase() as ActionType;
      const rawValue = token.substring(colonIndex + 1);
      const value = stripQuotes(rawValue);

      if (!VALID_ACTION_TYPES.includes(type)) {
        throw new Error(`Unknown action: "${type}". Valid actions: ${VALID_ACTION_TYPES.join(', ')}`);
      }

      if ((type === 'add-label' || type === 'remove-label') && !value) {
        throw new Error(`${type} requires a value (e.g., ${type}:bug or ${type}:"stage: QA")`);
      }

      actions.push({ type, value });
    }
  }

  return actions;
}
