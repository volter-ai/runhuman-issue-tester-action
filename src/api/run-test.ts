import * as core from '@actions/core';
import type { QATestResponse, AnalyzeIssueResponse, LinkedIssue, PlaywrightData, PRContext, PRComment } from '../types';

interface CreateJobRequest {
  url: string;
  description: string;
  outputSchema: Record<string, unknown>;
  targetDurationMinutes?: number;
  additionalValidationInstructions?: string;
}

interface CreateJobResponse {
  jobId: string;
  message?: string;
}

interface JobStatusResponse {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'abandoned' | 'incomplete';
  result?: {
    success: boolean;
    explanation: string;
    data: Record<string, unknown>;
  };
  error?: string;
  reason?: string;
  costUsd?: number;
  testDurationSeconds?: number;
  testerData?: unknown;
  testerResponse?: string;
  testerAlias?: string;
  testerAvatarUrl?: string;
  testerColor?: string;
}

// Terminal states that indicate the job is done
const TERMINAL_STATES = ['completed', 'error', 'abandoned', 'incomplete'];

// Polling configuration
const POLL_INTERVAL_MS = 60000; // 1 minute between polls
const MAX_POLL_DURATION_MS = 20 * 60 * 1000; // 20 minutes max

/**
 * Create a QA test job via the async API
 */
async function createJob(
  apiKey: string,
  apiUrl: string,
  request: CreateJobRequest
): Promise<string> {
  const endpoint = `${apiUrl}/api/jobs`;

  core.info(`Creating QA test job for ${request.url}...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'runhuman-issue-tester-action/1.0.0',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;

    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorData.message || JSON.stringify(errorData);
    } catch {
      errorMessage = errorText || '(empty response body)';
    }

    core.error(`Failed to create job:`);
    core.error(`  Status: ${response.status} ${response.statusText}`);
    core.error(`  URL: ${endpoint}`);
    core.error(`  Body: ${errorText || '(empty)'}`);

    if (response.status === 401) {
      throw new Error(
        'Authentication failed: Invalid API key. ' +
          'Make sure your RUNHUMAN_API_KEY secret is set correctly.'
      );
    }

    throw new Error(`Failed to create job (${response.status}): ${errorMessage}`);
  }

  const data = (await response.json()) as CreateJobResponse;

  if (!data.jobId) {
    throw new Error('API did not return a job ID');
  }

  core.info(`Job created: ${data.jobId}`);
  return data.jobId;
}

/**
 * Get the status of a job
 */
async function getJobStatus(
  apiKey: string,
  apiUrl: string,
  jobId: string
): Promise<JobStatusResponse> {
  const endpoint = `${apiUrl}/api/jobs/${jobId}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'runhuman-issue-tester-action/1.0.0',
      },
    });
  } catch (fetchError) {
    // Network-level error (DNS, connection refused, timeout, etc.)
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    const errorCause = fetchError instanceof Error && fetchError.cause ? ` Cause: ${JSON.stringify(fetchError.cause)}` : '';
    core.error(`Network error fetching job status:`);
    core.error(`  URL: ${endpoint}`);
    core.error(`  Error: ${errorMessage}${errorCause}`);
    throw new Error(`Network error checking job status: ${errorMessage}${errorCause}`);
  }

  if (!response.ok) {
    const errorText = await response.text();

    if (response.status === 404) {
      throw new Error(`Job ${jobId} not found`);
    }

    core.error(`HTTP error fetching job status:`);
    core.error(`  URL: ${endpoint}`);
    core.error(`  Status: ${response.status} ${response.statusText}`);
    core.error(`  Body: ${errorText || '(empty)'}`);

    throw new Error(`Failed to get job status (${response.status}): ${errorText || response.statusText}`);
  }

  return (await response.json()) as JobStatusResponse;
}

/**
 * Poll for job completion
 */
async function pollForCompletion(
  apiKey: string,
  apiUrl: string,
  jobId: string
): Promise<JobStatusResponse> {
  const startTime = Date.now();
  let lastStatus = '';

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed > MAX_POLL_DURATION_MS) {
      throw new Error(
        `Job ${jobId} did not complete within 20 minutes. ` +
          `Last status: ${lastStatus}. The job may still be running - check the RunHuman dashboard.`
      );
    }

    const status = await getJobStatus(apiKey, apiUrl, jobId);
    lastStatus = status.status;

    // Log status changes
    core.info(`Job ${jobId} status: ${status.status} (${Math.round(elapsed / 1000)}s elapsed)`);

    if (TERMINAL_STATES.includes(status.status)) {
      return status;
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Character limits for context formatting
const ISSUE_BODY_LIMIT = 2000;
const PR_BODY_LIMIT = 1500;
const COMMENT_BODY_LIMIT = 500;
const MAX_COMMENTS = 10;

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.substring(0, limit) + '... (truncated)';
}

/**
 * Format the issue section of the context
 */
function formatIssueSection(issue: LinkedIssue): string {
  const labels = issue.labels.map((l) => l.name).join(', ') || 'None';
  const body = truncateText(issue.body, ISSUE_BODY_LIMIT);

  return `=== Original Issue Context ===
Title: ${issue.title}
Labels: ${labels}

Issue Description:
${body}`;
}

/**
 * Format comments for the PR section
 */
function formatComments(comments: PRComment[]): string {
  if (comments.length === 0) return '';

  const limitedComments = comments.slice(0, MAX_COMMENTS);
  const formatted = limitedComments
    .map((c) => {
      const commentType = c.isReviewComment ? 'review' : 'comment';
      const body = truncateText(c.body, COMMENT_BODY_LIMIT);
      return `@${c.author} (${commentType}):\n${body}`;
    })
    .join('\n\n');

  const truncationNote =
    comments.length > MAX_COMMENTS
      ? `\n\n(${comments.length - MAX_COMMENTS} additional comments not shown)`
      : '';

  return `

Discussion:
${formatted}${truncationNote}`;
}

/**
 * Format the PR section of the context
 */
function formatPRSection(pr: PRContext): string {
  const body = truncateText(pr.body, PR_BODY_LIMIT);
  const commentsText = formatComments(pr.comments);

  return `

=== Pull Request Context ===
PR #${pr.number}: ${pr.title}
Author: @${pr.author}

PR Description:
${body}${commentsText}`;
}

/**
 * Format combined issue + PR context for validation instructions
 */
function formatTestingContext(issue: LinkedIssue, prContext: PRContext | null): string {
  const issueSection = formatIssueSection(issue);
  const prSection = prContext ? formatPRSection(prContext) : '';

  return `${issueSection}${prSection}

When validating the test results, consider whether the tester's findings align with the expectations and requirements described in the original issue${prContext ? ' and PR context' : ''} above. The test should be marked as passing only if the issue appears to be properly resolved or the feature works as described.`;
}

/**
 * Call the RunHuman API to run a QA test (async with polling)
 */
export async function runQATest(
  apiKey: string,
  apiUrl: string,
  analysis: AnalyzeIssueResponse,
  targetDurationMinutes: number,
  issue: LinkedIssue,
  prContext: PRContext | null
): Promise<QATestResponse> {
  if (!analysis.testUrl) {
    throw new Error('No test URL provided in analysis');
  }

  core.debug(`Running QA test on ${analysis.testUrl}`);

  // Step 1: Create the job
  const jobId = await createJob(apiKey, apiUrl, {
    url: analysis.testUrl,
    description: analysis.testInstructions,
    outputSchema: analysis.outputSchema,
    targetDurationMinutes,
    additionalValidationInstructions: formatTestingContext(issue, prContext),
  });

  // Step 2: Poll for completion
  core.info(`Waiting for job ${jobId} to complete (max 20 minutes)...`);
  const finalStatus = await pollForCompletion(apiKey, apiUrl, jobId);

  // Step 3: Convert to QATestResponse format
  const response: QATestResponse = {
    status: finalStatus.status,
    result: finalStatus.result,
    error: finalStatus.error || finalStatus.reason,
    costUsd: finalStatus.costUsd,
    testDurationSeconds: finalStatus.testDurationSeconds,
    jobId: finalStatus.id,
    testerData: finalStatus.testerData as PlaywrightData | undefined,
  };

  if (finalStatus.status === 'completed') {
    core.info(`Job ${jobId} completed successfully`);
  } else {
    core.warning(`Job ${jobId} ended with status: ${finalStatus.status}`);
    if (finalStatus.error) {
      core.warning(`Error: ${finalStatus.error}`);
    }
    if (finalStatus.reason) {
      core.warning(`Reason: ${finalStatus.reason}`);
    }
  }

  core.debug(`Test complete: status=${response.status}, success=${response.result?.success}`);

  return response;
}
