import * as github from '@actions/github';
import * as core from '@actions/core';
import type { LinkedIssue } from '../types';

/**
 * GraphQL query to get issues that will be closed by a pull request
 */
const LINKED_ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        closingIssuesReferences(first: 50) {
          nodes {
            number
            title
            body
            state
            labels(first: 20) {
              nodes {
                name
              }
            }
          }
        }
      }
    }
  }
`;

interface GraphQLResponse {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        nodes: Array<{
          number: number;
          title: string;
          body: string;
          state: 'OPEN' | 'CLOSED';
          labels: {
            nodes: Array<{ name: string }>;
          };
        }>;
      };
    };
  };
}

/**
 * Find the merged PR associated with a commit SHA
 */
export async function findMergedPRForCommit(githubToken: string): Promise<number | null> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;
  const commitSha = github.context.sha;

  core.debug(`Looking for merged PR containing commit ${commitSha}`);

  try {
    // Find PRs associated with this commit
    const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });

    // Find the merged PR
    const mergedPR = prs.find((pr) => pr.merged_at !== null);

    if (mergedPR) {
      core.info(`Found merged PR #${mergedPR.number} for commit ${commitSha}`);
      return mergedPR.number;
    }

    core.debug(`No merged PR found for commit ${commitSha}`);
    return null;
  } catch (error) {
    core.warning(`Error finding PR for commit: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Get linked issues from a pull request
 * @param prNumber Optional PR number. If not provided, uses context.payload.pull_request
 */
export async function getLinkedIssues(githubToken: string, prNumber?: number): Promise<LinkedIssue[]> {
  const octokit = github.getOctokit(githubToken);
  const context = github.context;

  const effectivePrNumber = prNumber ?? context.payload.pull_request?.number;

  if (!effectivePrNumber) {
    core.warning('No pull request number found in context');
    return [];
  }

  const { owner, repo } = context.repo;

  core.debug(`Fetching linked issues for PR #${effectivePrNumber} in ${owner}/${repo}`);

  const result = await octokit.graphql<GraphQLResponse>(LINKED_ISSUES_QUERY, {
    owner,
    repo,
    prNumber: effectivePrNumber,
  });

  const nodes = result.repository.pullRequest.closingIssuesReferences.nodes;

  const linkedIssues: LinkedIssue[] = nodes.map((node) => ({
    number: node.number,
    title: node.title,
    body: node.body,
    state: node.state,
    labels: node.labels.nodes,
  }));

  core.info(`Found ${linkedIssues.length} linked issues`);

  return linkedIssues;
}

/**
 * Check if an issue has a specific label
 */
export function hasLabel(issue: LinkedIssue, labelName: string): boolean {
  return issue.labels.some((label) => label.name.toLowerCase() === labelName.toLowerCase());
}

/**
 * Parse issue numbers from a commit message
 * Matches patterns like: Fixes #123, Closes #456, Resolves #789, etc.
 * @param customPattern Optional additional regex pattern (must have capture group for issue number)
 */
export function parseIssueNumbersFromCommitMessage(message: string, customPattern?: string | null): number[] {
  const issueNumbers = new Set<number>();

  // GitHub keywords that link to issues: https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
  const defaultPattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*#(\d+)/gi;
  const defaultMatches = message.matchAll(defaultPattern);

  for (const match of defaultMatches) {
    issueNumbers.add(parseInt(match[1], 10));
  }

  // Also match custom pattern if provided
  if (customPattern) {
    try {
      const customRegex = new RegExp(customPattern, 'gi');
      const customMatches = message.matchAll(customRegex);

      for (const match of customMatches) {
        // Use first capture group, or full match if no groups
        const numStr = match[1] || match[0];
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > 0) {
          issueNumbers.add(num);
        }
      }
    } catch (error) {
      core.warning(`Invalid custom issue pattern: ${customPattern}`);
    }
  }

  return Array.from(issueNumbers);
}

/**
 * Get issues referenced in the current commit message
 * @param customPattern Optional additional regex pattern for matching issue numbers
 */
export async function getIssuesFromCommitMessage(githubToken: string, customPattern?: string | null): Promise<LinkedIssue[]> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;
  const commitSha = github.context.sha;

  core.debug(`Fetching commit message for ${commitSha}`);

  try {
    const { data: commit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });

    const issueNumbers = parseIssueNumbersFromCommitMessage(commit.message, customPattern);

    if (issueNumbers.length === 0) {
      core.debug('No issue references found in commit message');
      return [];
    }

    core.info(`Found ${issueNumbers.length} issue reference(s) in commit message: ${issueNumbers.map(n => `#${n}`).join(', ')}`);

    // Fetch each issue
    const issues: LinkedIssue[] = [];
    for (const num of issueNumbers) {
      const issue = await getIssueByNumber(githubToken, num);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  } catch (error) {
    core.warning(`Error fetching commit message: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Get a single issue by number (for manual testing mode)
 */
export async function getIssueByNumber(
  githubToken: string,
  issueNumber: number
): Promise<LinkedIssue | null> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Fetching issue #${issueNumber} from ${owner}/${repo}`);

  try {
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    // Filter out PRs (GitHub treats PRs as issues in the API)
    if (issue.pull_request) {
      core.warning(`#${issueNumber} is a pull request, not an issue`);
      return null;
    }

    const linkedIssue: LinkedIssue = {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
      labels: issue.labels
        .filter((l): l is { name: string } => typeof l === 'object' && l !== null && 'name' in l)
        .map((l) => ({ name: l.name! })),
    };

    core.info(`Found issue #${issueNumber}: ${linkedIssue.title}`);
    return linkedIssue;
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
      core.warning(`Issue #${issueNumber} not found`);
      return null;
    }
    throw error;
  }
}
