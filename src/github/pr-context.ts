import * as github from '@actions/github';
import * as core from '@actions/core';
import type { PRContext, PRComment } from '../types';

/**
 * Check if a comment author is a bot
 */
function isBotAuthor(author: string): boolean {
  const lowerAuthor = author.toLowerCase();
  return (
    lowerAuthor.endsWith('[bot]') ||
    lowerAuthor === 'github-actions' ||
    lowerAuthor.includes('dependabot')
  );
}

/**
 * Fetch complete PR context including description and comments
 */
export async function getPRContext(
  githubToken: string,
  prNumber: number
): Promise<PRContext> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Fetching PR #${prNumber} context from ${owner}/${repo}`);

  // Fetch PR details
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  // Fetch issue comments (general PR discussion)
  const { data: issueComments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  // Fetch review comments (code-specific comments)
  const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // Convert and filter comments
  const allComments: PRComment[] = [];

  for (const comment of issueComments) {
    const author = comment.user?.login ?? 'unknown';
    if (!isBotAuthor(author) && comment.body) {
      allComments.push({
        body: comment.body,
        author,
        createdAt: comment.created_at,
        isReviewComment: false,
      });
    }
  }

  for (const comment of reviewComments) {
    const author = comment.user?.login ?? 'unknown';
    if (!isBotAuthor(author) && comment.body) {
      allComments.push({
        body: comment.body,
        author,
        createdAt: comment.created_at,
        isReviewComment: true,
      });
    }
  }

  // Sort chronologically (oldest first)
  allComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const prContext: PRContext = {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    author: pr.user?.login ?? 'unknown',
    comments: allComments,
  };

  core.debug(`Fetched PR context: ${allComments.length} comments`);

  return prContext;
}
