import * as github from '@actions/github';
import * as core from '@actions/core';
import type { LinkedIssue } from '../types';

/**
 * Parsed filter options from filter query string
 */
export interface IssueFilterOptions {
  state: 'open' | 'closed' | 'all';
  ageGreaterThanDays?: number;
  staleDays?: number;
  unassigned?: boolean;
  assignee?: string;
  labels?: string[];
}

/**
 * Parse a filter query string into IssueFilterOptions
 *
 * Supported syntax:
 * - state:open, state:closed, state:all
 * - age:>30d (created more than 30 days ago)
 * - stale:30d (no activity in 30 days)
 * - unassigned
 * - assigned:username
 * - label:bug or label:bug,enhancement
 * - all (shorthand for state:open)
 *
 * @example parseIssueFilter('state:open age:>30d unassigned')
 * @example parseIssueFilter('state:open stale:7d label:bug,needs-testing')
 */
export function parseIssueFilter(filter: string): IssueFilterOptions {
  const options: IssueFilterOptions = {
    state: 'open', // Default to open issues
  };

  const tokens = filter.trim().split(/\s+/);

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();

    // Handle 'all' shorthand
    if (lowerToken === 'all') {
      options.state = 'open';
      continue;
    }

    // Handle 'unassigned' flag
    if (lowerToken === 'unassigned') {
      options.unassigned = true;
      continue;
    }

    // Handle key:value pairs
    const colonIndex = token.indexOf(':');
    if (colonIndex === -1) {
      core.warning(`Unknown filter token: ${token}`);
      continue;
    }

    const key = token.substring(0, colonIndex).toLowerCase();
    const value = token.substring(colonIndex + 1);

    switch (key) {
      case 'state':
        if (value === 'open' || value === 'closed' || value === 'all') {
          options.state = value;
        } else {
          throw new Error(`Invalid state value: ${value}. Must be 'open', 'closed', or 'all'`);
        }
        break;

      case 'age':
        options.ageGreaterThanDays = parseDays(value, 'age');
        break;

      case 'stale':
        options.staleDays = parseDays(value, 'stale');
        break;

      case 'assigned':
        options.assignee = value;
        break;

      case 'label':
        options.labels = value.split(',').map(l => l.trim()).filter(Boolean);
        break;

      default:
        core.warning(`Unknown filter key: ${key}`);
    }
  }

  return options;
}

/**
 * Parse a days value like '>30d' or '7d' into a number
 */
function parseDays(value: string, filterName: string): number {
  // Remove leading '>' if present
  const normalized = value.startsWith('>') ? value.substring(1) : value;

  // Remove trailing 'd' if present
  const numStr = normalized.endsWith('d') ? normalized.slice(0, -1) : normalized;

  const days = parseInt(numStr, 10);
  if (isNaN(days) || days < 0) {
    throw new Error(`Invalid ${filterName} value: ${value}. Expected format like '30d' or '>30d'`);
  }

  return days;
}

/**
 * Query GitHub issues with filters
 */
export async function queryIssuesWithFilter(
  githubToken: string,
  options: IssueFilterOptions,
  maxIssues: number
): Promise<LinkedIssue[]> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.info(`Querying issues with filter: ${JSON.stringify(options)}`);

  // Build query parameters for GitHub REST API
  const queryParams: Parameters<typeof octokit.rest.issues.listForRepo>[0] = {
    owner,
    repo,
    state: options.state,
    per_page: Math.min(maxIssues, 100), // GitHub max is 100 per page
    sort: 'updated',
    direction: 'desc',
  };

  // Add assignee filter
  if (options.unassigned) {
    queryParams.assignee = 'none';
  } else if (options.assignee) {
    queryParams.assignee = options.assignee;
  }

  // Add labels filter (comma-separated)
  if (options.labels && options.labels.length > 0) {
    queryParams.labels = options.labels.join(',');
  }

  // Calculate date cutoffs for age/stale filters
  const now = new Date();
  let createdBefore: Date | undefined;
  let updatedBefore: Date | undefined;

  if (options.ageGreaterThanDays !== undefined) {
    createdBefore = new Date(now.getTime() - options.ageGreaterThanDays * 24 * 60 * 60 * 1000);
  }

  if (options.staleDays !== undefined) {
    updatedBefore = new Date(now.getTime() - options.staleDays * 24 * 60 * 60 * 1000);
  }

  // Fetch issues (may need multiple pages if maxIssues > 100)
  const allIssues: LinkedIssue[] = [];
  let page = 1;

  while (allIssues.length < maxIssues) {
    const { data: issues } = await octokit.rest.issues.listForRepo({
      ...queryParams,
      page,
    });

    if (issues.length === 0) break;

    for (const issue of issues) {
      // Skip pull requests (GitHub API includes PRs in issues endpoint)
      if (issue.pull_request) continue;

      // Apply date filters (GitHub API doesn't support 'created before')
      if (createdBefore) {
        const createdAt = new Date(issue.created_at);
        if (createdAt >= createdBefore) continue;
      }

      if (updatedBefore) {
        const updatedAt = new Date(issue.updated_at);
        if (updatedAt >= updatedBefore) continue;
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

      allIssues.push(linkedIssue);

      if (allIssues.length >= maxIssues) break;
    }

    // If we got fewer than requested, no more pages
    if (issues.length < queryParams.per_page!) break;
    page++;
  }

  core.info(`Found ${allIssues.length} issues matching filter`);
  return allIssues;
}

/**
 * Get multiple issues by their numbers
 */
export async function getIssuesByNumbers(
  githubToken: string,
  issueNumbers: number[]
): Promise<LinkedIssue[]> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.info(`Fetching ${issueNumbers.length} issues: ${issueNumbers.map(n => `#${n}`).join(', ')}`);

  const issues: LinkedIssue[] = [];

  for (const issueNumber of issueNumbers) {
    try {
      const { data: issue } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      // Skip pull requests
      if (issue.pull_request) {
        core.warning(`#${issueNumber} is a pull request, skipping`);
        continue;
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

      issues.push(linkedIssue);
      core.info(`Found issue #${issueNumber}: ${linkedIssue.title}`);
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
        core.warning(`Issue #${issueNumber} not found, skipping`);
      } else {
        throw error;
      }
    }
  }

  return issues;
}
