/**
 * Executor for parsed actions.
 * Executes GitHub issue management operations based on parsed action DSL.
 */

import * as core from '@actions/core';
import { ensureIssueClosed, reopenIssue, addLabel, removeLabel } from '../github/issue-manager';
import { postNotTestableComment } from '../github/issue-commenter';
import type { ParsedAction } from './action-parser';

export interface ActionContext {
  githubToken: string;
  issueNumber: number;
  /** Reason for the action (for not-testable or failure comments) */
  reason?: string;
}

/**
 * Execute a list of parsed actions on an issue.
 *
 * @example
 * await executeActions(
 *   [{ type: 'close' }, { type: 'add-label', value: 'released' }],
 *   { githubToken: 'xxx', issueNumber: 123 }
 * );
 */
export async function executeActions(
  actions: ParsedAction[],
  context: ActionContext
): Promise<void> {
  if (actions.length === 0) return;

  core.info(`Executing ${actions.length} action(s) on issue #${context.issueNumber}`);

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'close':
          await ensureIssueClosed(context.githubToken, context.issueNumber);
          break;

        case 'open':
          await reopenIssue(context.githubToken, context.issueNumber);
          break;

        case 'add-label':
          if (action.value) {
            await addLabel(context.githubToken, context.issueNumber, action.value);
          }
          break;

        case 'remove-label':
          if (action.value) {
            await removeLabel(context.githubToken, context.issueNumber, action.value);
          }
          break;

        case 'comment':
          if (context.reason) {
            await postNotTestableComment(context.githubToken, context.issueNumber, context.reason);
          }
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      core.warning(`Failed to execute action "${action.type}" on issue #${context.issueNumber}: ${errorMessage}`);
      // Continue with other actions even if one fails
    }
  }
}
