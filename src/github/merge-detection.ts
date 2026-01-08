import * as github from '@actions/github';
import * as core from '@actions/core';
import type { MergeCommit, MergeFileChange } from '../types';

/** Maximum diff content size to send to the API (in characters) */
const MAX_DIFF_CONTENT_SIZE = 15000;

/**
 * Check if the current commit is a merge commit (has 2+ parents)
 */
export async function isMergeCommit(githubToken: string): Promise<boolean> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;
  const commitSha = github.context.sha;

  core.debug(`Checking if commit ${commitSha} is a merge commit`);

  try {
    const { data: commit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });

    const isMerge = commit.parents.length >= 2;
    core.debug(`Commit ${commitSha} has ${commit.parents.length} parent(s) - isMerge: ${isMerge}`);

    return isMerge;
  } catch (error) {
    core.warning(`Error checking if commit is merge: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Get merge data including commits, file changes, and diff content
 */
export async function getMergeData(githubToken: string): Promise<{
  commits: MergeCommit[];
  fileChanges: MergeFileChange[];
  diffContent: string;
} | null> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;
  const commitSha = github.context.sha;

  try {
    // First, get the commit to find its parents
    const { data: commit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });

    if (commit.parents.length < 2) {
      core.debug('Not a merge commit, cannot get merge data');
      return null;
    }

    // Compare with the first parent (the base branch before merge)
    const baseSha = commit.parents[0].sha;

    core.info(`Comparing ${baseSha.slice(0, 7)}...${commitSha.slice(0, 7)} to get merge changes`);

    // Get the comparison which includes commits, files, and patches
    const { data: comparison } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: commitSha,
    });

    // Extract commits
    const commits: MergeCommit[] = comparison.commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name || c.author?.login || 'unknown',
      timestamp: c.commit.author?.date || new Date().toISOString(),
    }));

    // Extract file changes
    const fileChanges: MergeFileChange[] = (comparison.files || []).map((f) => ({
      filename: f.filename,
      status: f.status as 'added' | 'modified' | 'removed' | 'renamed',
      additions: f.additions,
      deletions: f.deletions,
      previousFilename: f.previous_filename,
    }));

    // Build diff content from patches
    const diffParts: string[] = [];
    let currentSize = 0;

    for (const file of comparison.files || []) {
      if (!file.patch) continue;

      const fileDiff = `--- ${file.filename} ---\n${file.patch}`;
      const fileSize = fileDiff.length;

      // Check if adding this file would exceed the limit
      if (currentSize + fileSize > MAX_DIFF_CONTENT_SIZE) {
        // Add truncation notice
        diffParts.push(`\n... (diff truncated, ${comparison.files?.length || 0} total files changed)`);
        break;
      }

      diffParts.push(fileDiff);
      currentSize += fileSize;
    }

    const diffContent = diffParts.join('\n\n');

    core.info(`Merge data: ${commits.length} commits, ${fileChanges.length} files, ${diffContent.length} chars of diff`);

    return {
      commits,
      fileChanges,
      diffContent,
    };
  } catch (error) {
    core.warning(`Error getting merge data: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
