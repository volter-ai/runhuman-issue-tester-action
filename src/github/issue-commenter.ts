import * as github from '@actions/github';
import * as core from '@actions/core';
import type { QATestResponse, AnalyzeIssueResponse } from '../types';
import { buildTestResultComment } from '../templates/comment-template';

/**
 * Post a test result comment to a GitHub issue
 */
export async function postTestResultComment(
  githubToken: string,
  issueNumber: number,
  testResult: QATestResponse,
  analysis: AnalyzeIssueResponse
): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;

  const comment = buildTestResultComment(testResult, analysis);

  core.debug(`Posting comment to issue #${issueNumber}`);

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  core.info(`Posted test result comment to issue #${issueNumber}`);
}
