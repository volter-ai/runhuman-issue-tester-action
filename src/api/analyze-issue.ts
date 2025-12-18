import * as core from '@actions/core';
import type { AnalyzeIssueResponse, LinkedIssue } from '../types';

interface AnalyzeIssueRequest {
  issueTitle: string;
  issueBody: string;
  issueLabels: string[];
  repoContext?: string;
  presetTestUrl?: string;
}

/**
 * Call the RunHuman API to analyze a GitHub issue
 * @param presetTestUrl Optional preset URL to use as base - AI will use/enhance this
 */
export async function analyzeIssue(
  apiKey: string,
  apiUrl: string,
  issue: LinkedIssue,
  presetTestUrl?: string
): Promise<AnalyzeIssueResponse> {
  const endpoint = `${apiUrl}/api/analyze-issue`;

  core.debug(`Analyzing issue #${issue.number}: "${issue.title}"`);
  if (presetTestUrl) {
    core.debug(`Using preset test URL: ${presetTestUrl}`);
  }

  const requestBody: AnalyzeIssueRequest = {
    issueTitle: issue.title,
    issueBody: issue.body,
    issueLabels: issue.labels.map((l) => l.name),
    presetTestUrl,
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

    throw new Error(`Issue analysis failed (${response.status}): ${errorMessage}`);
  }

  const data = (await response.json()) as AnalyzeIssueResponse;

  core.debug(`Analysis complete: isTestable=${data.isTestable}, confidence=${data.confidence}`);

  return data;
}
