import * as github from '@actions/github';
import * as core from '@actions/core';

/**
 * Reopen a closed issue
 */
export async function reopenIssue(githubToken: string, issueNumber: number): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Reopening issue #${issueNumber}`);

  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'open',
  });

  core.info(`Reopened issue #${issueNumber}`);
}

/**
 * Close an open issue
 */
export async function closeIssue(githubToken: string, issueNumber: number): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Closing issue #${issueNumber}`);

  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'closed',
  });

  core.info(`Closed issue #${issueNumber}`);
}

/**
 * Add a label to an issue
 */
export async function addLabel(githubToken: string, issueNumber: number, label: string): Promise<void> {
  if (!label) return;

  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Adding label "${label}" to issue #${issueNumber}`);

  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: [label],
  });

  core.info(`Added label "${label}" to issue #${issueNumber}`);
}

/**
 * Remove a label from an issue
 */
export async function removeLabel(githubToken: string, issueNumber: number, label: string): Promise<void> {
  if (!label) return;

  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Removing label "${label}" from issue #${issueNumber}`);

  try {
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: label,
    });

    core.info(`Removed label "${label}" from issue #${issueNumber}`);
  } catch (error) {
    // Label might not exist on the issue - that's okay
    if ((error as { status?: number }).status === 404) {
      core.debug(`Label "${label}" not found on issue #${issueNumber}, skipping removal`);
    } else {
      throw error;
    }
  }
}

/**
 * Ensure an issue is closed (close if open)
 */
export async function ensureIssueClosed(githubToken: string, issueNumber: number): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  // Get current issue state
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  if (issue.state === 'open') {
    await closeIssue(githubToken, issueNumber);
  } else {
    core.debug(`Issue #${issueNumber} is already closed`);
  }
}
