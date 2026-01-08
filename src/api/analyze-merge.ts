import * as core from '@actions/core';
import type { AnalyzeMergeRequest, AnalyzeMergeResponse, MergeCommit, MergeFileChange } from '../types';

/**
 * Call the Runhuman API to analyze a merge for testability
 */
export async function analyzeMerge(
  apiKey: string,
  apiUrl: string,
  commits: MergeCommit[],
  fileChanges: MergeFileChange[],
  diffContent: string,
  testUrl: string,
  prTitle?: string,
  prBody?: string,
  githubRepo?: string
): Promise<AnalyzeMergeResponse> {
  const endpoint = `${apiUrl}/api/merge-analyzer`;

  core.debug(`Analyzing merge: ${commits.length} commits, ${fileChanges.length} files`);
  core.debug(`Diff content size: ${diffContent.length} chars`);
  if (githubRepo) {
    core.debug(`Using GitHub repo context: ${githubRepo}`);
  }

  const requestBody: AnalyzeMergeRequest = {
    commits,
    fileChanges,
    diffContent,
    testUrl,
    prTitle,
    prBody,
    githubRepo,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'runhuman-issue-tester-action/1.0.0',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(60000), // 1 minute timeout for analysis
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;

    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorData.message || errorText;
    } catch {
      errorMessage = errorText;
    }

    if (response.status === 401) {
      throw new Error(
        'Authentication failed: Invalid API key. ' +
          'Make sure your RUNHUMAN_API_KEY secret is set correctly.'
      );
    }

    throw new Error(`Merge analysis failed (${response.status}): ${errorMessage}`);
  }

  const data = (await response.json()) as AnalyzeMergeResponse;

  core.debug(`Analysis complete: isTestable=${data.isTestable}, confidence=${data.confidence}`);
  if (data.isTestable) {
    core.debug(`Affected areas: ${data.affectedAreas.join(', ')}`);
  }

  return data;
}
