import * as github from '@actions/github';
import * as core from '@actions/core';

/**
 * Fetch comments from a GitHub issue
 * @param githubToken GitHub token for API access
 * @param issueNumber Issue number to fetch comments for
 * @param maxComments Maximum number of comments to fetch (default: 20)
 * @returns Array of comment body strings
 */
export async function getIssueComments(
  githubToken: string,
  issueNumber: number,
  maxComments: number = 20
): Promise<string[]> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  core.debug(`Fetching comments for issue #${issueNumber} (max: ${maxComments})`);

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: maxComments,
  });

  const commentBodies = comments
    .filter((comment) => comment.body)
    .map((comment) => comment.body as string);

  core.debug(`Found ${commentBodies.length} comments for issue #${issueNumber}`);

  return commentBodies;
}
