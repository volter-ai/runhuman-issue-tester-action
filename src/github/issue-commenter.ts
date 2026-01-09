import * as github from '@actions/github';
import * as core from '@actions/core';
import { buildTestResultComment, buildJobFailedComment } from '@runhuman/shared';
import type { QATestResponse, AnalyzeIssueResponse } from '../types';

/** Job statuses that indicate the job failed (not just the test) */
const FAILED_JOB_STATUSES = ['abandoned', 'error', 'incomplete'];

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

  // Choose the appropriate template based on job status
  const isJobFailed = FAILED_JOB_STATUSES.includes(testResult.status);
  const comment = isJobFailed
    ? buildJobFailedComment(testResult, analysis)
    : buildTestResultComment(testResult, analysis);

  core.debug(`Posting comment to issue #${issueNumber} (job status: ${testResult.status})`);

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  core.info(`Posted test result comment to issue #${issueNumber}`);
}
