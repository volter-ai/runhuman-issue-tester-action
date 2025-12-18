import * as core from '@actions/core';
import type { ParsedInputs } from './types';

/**
 * Parse and validate action inputs
 */
export function parseInputs(): ParsedInputs {
  const apiKey = core.getInput('api-key', { required: true });
  const githubToken = core.getInput('github-token', { required: true });
  const apiUrl = core.getInput('api-url') || 'https://runhuman.com';
  const qaLabel = core.getInput('qa-label') || 'qa-test';
  const autoDetect = core.getInput('auto-detect') !== 'false';
  const targetDurationMinutesStr = core.getInput('target-duration-minutes') || '5';
  const reopenOnFailure = core.getInput('reopen-on-failure') !== 'false';
  const failureLabel = core.getInput('failure-label') || 'qa-failed';
  const removeFailureLabelOnSuccess = core.getInput('remove-failure-label-on-success') !== 'false';
  const issueNumberStr = core.getInput('issue-number');
  const testUrlStr = core.getInput('test-url');
  const issuePatternStr = core.getInput('issue-pattern');

  // Validate API key format
  if (!apiKey.startsWith('qa_live_')) {
    throw new Error(
      'Invalid API key format. API keys must start with "qa_live_". ' +
        'Get your API key from https://runhuman.com/dashboard'
    );
  }

  // Parse and validate target duration
  const targetDurationMinutes = parseInt(targetDurationMinutesStr, 10);
  if (isNaN(targetDurationMinutes) || targetDurationMinutes < 1 || targetDurationMinutes > 60) {
    throw new Error('target-duration-minutes must be a number between 1 and 60');
  }

  // Parse and validate issue number (optional)
  let issueNumber: number | null = null;
  if (issueNumberStr) {
    issueNumber = parseInt(issueNumberStr, 10);
    if (isNaN(issueNumber) || issueNumber < 1) {
      throw new Error('issue-number must be a positive integer');
    }
  }

  // Parse and validate test URL (optional)
  let testUrl: string | null = null;
  if (testUrlStr) {
    if (!isValidUrl(testUrlStr)) {
      throw new Error('test-url must be a valid URL (http:// or https://)');
    }
    testUrl = testUrlStr;
  }

  // Parse and validate issue pattern (optional)
  let issuePattern: string | null = null;
  if (issuePatternStr) {
    try {
      new RegExp(issuePatternStr);
      issuePattern = issuePatternStr;
    } catch {
      throw new Error('issue-pattern must be a valid regular expression');
    }
  }

  return {
    apiKey,
    githubToken,
    apiUrl,
    qaLabel,
    autoDetect,
    targetDurationMinutes,
    reopenOnFailure,
    failureLabel,
    removeFailureLabelOnSuccess,
    issueNumber,
    testUrl,
    issuePattern,
  };
}

/**
 * Validate that a string is a valid HTTP/HTTPS URL
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
