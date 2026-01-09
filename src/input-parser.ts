import * as core from '@actions/core';
import * as github from '@actions/github';
import type { ParsedInputs } from './types';
import { parseIssueFilter } from './github/issue-filter';

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
  const issueFilterStr = core.getInput('issue-filter');
  const maxIssuesStr = core.getInput('max-issues') || '10';
  const testUrlStr = core.getInput('test-url');
  const issuePatternStr = core.getInput('issue-pattern');
  const testMerges = core.getInput('test-merges') !== 'false';
  const autoModeOnlyMissingMedia = core.getInput('auto-mode-only-missing-media') === 'true';

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

  // Parse and validate issue numbers (comma-separated, optional)
  const issueNumbers = parseIssueNumbers(issueNumberStr);

  // Parse and validate issue filter (optional)
  let issueFilter: string | null = null;
  if (issueFilterStr) {
    // Validate by attempting to parse
    parseIssueFilter(issueFilterStr);
    issueFilter = issueFilterStr;
  }

  // Parse and validate max issues
  const maxIssues = parseInt(maxIssuesStr, 10);
  if (isNaN(maxIssues) || maxIssues < 1) {
    throw new Error('max-issues must be a positive integer');
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

  // Get current GitHub repo from context
  const { owner, repo } = github.context.repo;
  const githubRepo = `${owner}/${repo}`;

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
    issueNumbers,
    issueFilter,
    maxIssues,
    testUrl,
    issuePattern,
    githubRepo,
    testMerges,
    autoModeOnlyMissingMedia,
  };
}

/**
 * Parse comma-separated issue numbers
 * @example '123' → [123]
 * @example '123, 456, 789' → [123, 456, 789]
 */
function parseIssueNumbers(input: string): number[] {
  if (!input || !input.trim()) {
    return [];
  }

  const numbers: number[] = [];
  const parts = input.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1) {
      throw new Error(`Invalid issue number: "${trimmed}". Must be a positive integer.`);
    }
    numbers.push(num);
  }

  return numbers;
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
