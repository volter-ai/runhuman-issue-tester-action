import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseInputs } from './input-parser';
import { getLinkedIssues, hasLabel, findMergedPRForCommit, getIssuesFromCommitMessage } from './github/linked-issues';
import { isMergeCommit, getMergeData } from './github/merge-detection';
import { getPRContext } from './github/pr-context';
import { postTestResultComment } from './github/issue-commenter';
import { reopenIssue, addLabel, removeLabel, ensureIssueClosed } from './github/issue-manager';
import { parseIssueFilter, queryIssuesWithFilter, getIssuesByNumbers } from './github/issue-filter';
import { getIssueComments } from './github/issue-comments';
import { analyzeIssue } from './api/analyze-issue';
import { analyzeMerge } from './api/analyze-merge';
import { runQATest, runMergeTest } from './api/run-test';
import type { ActionResults, IssueTestResult, LinkedIssue, PRContext, MergeTestResult } from './types';

/**
 * Main entry point for the action
 */
async function run(): Promise<void> {
  const results: ActionResults = {
    testedIssues: [],
    passedIssues: [],
    failedIssues: [],
    skippedIssues: [],
    totalCostUsd: 0,
    results: [],
  };

  try {
    // 1. Parse inputs
    const inputs = parseInputs();
    core.debug('Inputs parsed successfully');

    let issuesToProcess: LinkedIssue[];
    let prContext: PRContext | null = null;

    // 2. Determine mode: manual (issue-number), filter (issue-filter), or auto (PR merge)
    if (inputs.issueNumbers.length > 0) {
      // Manual mode: test specific issue(s) (no PR context available)
      core.info(`Manual mode: Testing ${inputs.issueNumbers.length} issue(s): ${inputs.issueNumbers.map(n => `#${n}`).join(', ')}`);
      const issues = await getIssuesByNumbers(inputs.githubToken, inputs.issueNumbers);

      if (issues.length === 0) {
        core.setFailed(`No valid issues found from: ${inputs.issueNumbers.map(n => `#${n}`).join(', ')}`);
        return;
      }

      issuesToProcess = issues;
    } else if (inputs.issueFilter) {
      // Filter mode: query issues dynamically
      core.info(`Filter mode: Querying issues with filter "${inputs.issueFilter}" (max: ${inputs.maxIssues})`);
      const filterOptions = parseIssueFilter(inputs.issueFilter);
      const issues = await queryIssuesWithFilter(inputs.githubToken, filterOptions, inputs.maxIssues);

      if (issues.length === 0) {
        core.info('No issues matched the filter criteria');
        setOutputs(results);
        return;
      }

      core.info(`Found ${issues.length} issue(s) matching filter`);
      issuesToProcess = issues;
    } else {
      // PR merge mode: get linked issues from merged PR
      let prNumber: number | null = null;

      // Check if we're in a pull_request event
      const pullRequest = github.context.payload.pull_request;
      if (pullRequest) {
        if (!pullRequest.merged) {
          core.info('Pull request was not merged, skipping');
          setOutputs(results);
          return;
        }
        prNumber = pullRequest.number;
        core.info(`Processing merged PR #${prNumber}: ${pullRequest.title}`);
      } else {
        // Not a pull_request event - try to find PR from commit (push event after merge)
        core.info('No pull_request in payload, searching for merged PR from commit...');
        prNumber = await findMergedPRForCommit(inputs.githubToken);

        if (prNumber) {
          core.info(`Found merged PR #${prNumber} from commit`);
        } else {
          core.debug('No merged PR found for commit, will check commit message for issue references');
        }
      }

      // Fetch PR context (description + comments) if we have a PR
      if (prNumber) {
        try {
          prContext = await getPRContext(inputs.githubToken, prNumber);
          core.info(`Fetched PR #${prNumber} context: ${prContext.comments.length} comment(s)`);
        } catch (error) {
          core.warning(`Failed to fetch PR context: ${error instanceof Error ? error.message : error}`);
        }
      }

      // Get linked issues from PR via GraphQL (if we have a PR)
      const prLinkedIssues = prNumber ? await getLinkedIssues(inputs.githubToken, prNumber) : [];

      // Also get issues referenced in commit message
      const commitIssues = await getIssuesFromCommitMessage(inputs.githubToken, inputs.issuePattern);

      // Combine and deduplicate issues
      const issueMap = new Map<number, LinkedIssue>();
      for (const issue of prLinkedIssues) {
        issueMap.set(issue.number, issue);
      }
      for (const issue of commitIssues) {
        if (!issueMap.has(issue.number)) {
          issueMap.set(issue.number, issue);
        }
      }
      const linkedIssues = Array.from(issueMap.values());

      if (prLinkedIssues.length > 0) {
        core.info(`Found ${prLinkedIssues.length} issue(s) linked to PR`);
      }
      if (commitIssues.length > 0) {
        core.info(`Found ${commitIssues.length} issue(s) referenced in commit message`);
      }

      if (linkedIssues.length === 0) {
        // No linked issues - check if we should test the merge itself
        if (inputs.testMerges && inputs.testUrl) {
          core.info('No linked issues found, checking if this is a testable merge...');
          const mergeResult = await processMergeTest(inputs, results, prContext);
          if (mergeResult) {
            // Merge test was processed - set outputs and create summary
            setOutputs(results);
            await createMergeSummary(results, mergeResult);
            return;
          }
          // Merge test was not run (not a merge commit or not testable) - fall through
        } else if (inputs.testMerges && !inputs.testUrl) {
          core.info('No linked issues found. Provide test-url to enable merge testing.');
        } else {
          core.info('No linked issues found, merge testing disabled.');
        }
        setOutputs(results);
        return;
      }

      // Separate labeled issues (always tested) from unlabeled issues
      const labeledIssues = linkedIssues.filter((issue) => hasLabel(issue, inputs.qaLabel));
      const unlabeledIssues = linkedIssues.filter((issue) => !hasLabel(issue, inputs.qaLabel));

      if (labeledIssues.length > 0) {
        core.info(`Found ${labeledIssues.length} issue(s) with "${inputs.qaLabel}" label (will be tested)`);
      }

      if (inputs.autoDetect && unlabeledIssues.length > 0) {
        // Auto-detect mode: include unlabeled issues for AI to evaluate
        core.info(`Auto-detect enabled: ${unlabeledIssues.length} unlabeled issue(s) will be evaluated by AI`);
        issuesToProcess = [...labeledIssues, ...unlabeledIssues];
      } else {
        // No auto-detect: only labeled issues
        issuesToProcess = labeledIssues;
        for (const issue of unlabeledIssues) {
          core.info(`Skipping issue #${issue.number}: missing "${inputs.qaLabel}" label (auto-detect disabled)`);
          results.skippedIssues.push(issue.number);
          results.results.push({
            issueNumber: issue.number,
            status: 'skipped',
            passed: false,
            skipReason: `Missing "${inputs.qaLabel}" label`,
          });
        }
      }

      if (issuesToProcess.length === 0) {
        core.info('No testable issues found');
        setOutputs(results);
        return;
      }
    }

    core.info(`Processing ${issuesToProcess.length} issue(s)`);

    // 5. Process each issue sequentially
    for (const issue of issuesToProcess) {
      await processIssue(issue, inputs, results, prContext);
    }

    // 6. Set outputs
    setOutputs(results);

    // 7. Create workflow summary
    await createSummary(results);

    // 8. Determine if we should fail
    // Only fail if ALL tests had system errors (not test failures)
    const systemErrors = results.results.filter((r) => r.status === 'error');
    if (systemErrors.length > 0 && systemErrors.length === results.results.length) {
      core.setFailed('All tests failed due to system errors');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

/**
 * Process a single issue: analyze, test, comment, manage state
 */
async function processIssue(
  issue: LinkedIssue,
  inputs: ReturnType<typeof parseInputs>,
  results: ActionResults,
  prContext: PRContext | null
): Promise<void> {
  const result: IssueTestResult = {
    issueNumber: issue.number,
    status: 'skipped',
    passed: false,
  };

  try {
    core.info(`\n--- Processing issue #${issue.number}: ${issue.title} ---`);

    // Fetch issue comments if onlyMissingMedia is enabled
    if (inputs.autoModeOnlyMissingMedia) {
      core.info(`Fetching comments for issue #${issue.number} (only-missing-media mode)...`);
      issue.comments = await getIssueComments(inputs.githubToken, issue.number);
    }

    // Analyze the issue with AI (pass preset URL and repo context if provided)
    core.info(`Analyzing issue #${issue.number}...`);
    const analysis = await analyzeIssue(
      inputs.apiKey,
      inputs.apiUrl,
      issue,
      inputs.testUrl || undefined,
      inputs.githubRepo,
      inputs.autoModeOnlyMissingMedia
    );
    result.analysis = analysis;

    // Check if testable
    if (!analysis.isTestable) {
      core.info(`Issue #${issue.number} is not testable: ${analysis.reason}`);
      result.status = 'skipped';
      result.skipReason = analysis.reason || 'Not testable by human';
      results.skippedIssues.push(issue.number);
      results.results.push(result);
      return;
    }

    // Determine test URL: manual override takes precedence
    const testUrl = inputs.testUrl || analysis.testUrl;

    if (!testUrl) {
      core.info(`Issue #${issue.number}: No testable URL found`);
      result.status = 'skipped';
      result.skipReason = 'No testable URL found in issue (provide test-url input to override)';
      results.skippedIssues.push(issue.number);
      results.results.push(result);
      return;
    }

    if (inputs.testUrl) {
      core.info(`Issue #${issue.number}: Using manual URL override: ${inputs.testUrl}`);
    }

    // Update analysis.testUrl for downstream use (runQATest, comments)
    analysis.testUrl = testUrl;

    core.info(`Issue #${issue.number}: Testing ${analysis.testUrl}`);
    core.info(`Instructions: ${analysis.testInstructions.substring(0, 100)}...`);

    // Run the QA test
    core.info(`Running QA test for issue #${issue.number}...`);
    const testResult = await runQATest(
      inputs.apiKey,
      inputs.apiUrl,
      analysis,
      inputs.targetDurationMinutes,
      issue,
      prContext,
      inputs.githubRepo
    );
    result.testResult = testResult;
    result.status = 'tested';
    result.passed = testResult.result?.success ?? false;

    // Track cost
    if (testResult.costUsd) {
      results.totalCostUsd += testResult.costUsd;
    }

    // Post comment to issue
    core.info(`Posting results to issue #${issue.number}...`);
    await postTestResultComment(inputs.githubToken, issue.number, testResult, analysis);

    // Manage issue state based on test result
    if (result.passed) {
      core.info(`Issue #${issue.number}: Test PASSED`);
      results.passedIssues.push(issue.number);

      // Close issue and remove failure label
      if (inputs.closeOnSuccess) {
        await ensureIssueClosed(inputs.githubToken, issue.number);
      }
      if (inputs.removeFailureLabelOnSuccess && inputs.failureLabel) {
        await removeLabel(inputs.githubToken, issue.number, inputs.failureLabel);
      }
    } else {
      core.info(`Issue #${issue.number}: Test FAILED`);
      results.failedIssues.push(issue.number);

      // Reopen issue and add failure label
      if (inputs.reopenOnFailure) {
        await reopenIssue(inputs.githubToken, issue.number);
      }
      if (inputs.failureLabel) {
        await addLabel(inputs.githubToken, issue.number, inputs.failureLabel);
      }
    }

    results.testedIssues.push(issue.number);
    results.results.push(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.warning(`Error processing issue #${issue.number}: ${errorMessage}`);

    result.status = 'error';
    result.error = errorMessage;
    results.results.push(result);
  }
}

/**
 * Process a merge test when no linked issues are found
 * Returns the merge test result if a test was run, null otherwise
 */
async function processMergeTest(
  inputs: ReturnType<typeof parseInputs>,
  results: ActionResults,
  prContext: PRContext | null
): Promise<MergeTestResult | null> {
  const result: MergeTestResult = {
    status: 'skipped',
    passed: false,
  };

  try {
    // Check if this is a merge commit
    if (!(await isMergeCommit(inputs.githubToken))) {
      core.info('Not a merge commit, skipping merge test');
      return null;
    }

    core.info('Detected merge commit, fetching merge data...');

    // Get merge data (commits, file changes, diff content)
    const mergeData = await getMergeData(inputs.githubToken);
    if (!mergeData) {
      core.warning('Failed to get merge data');
      return null;
    }

    core.info(`Merge contains ${mergeData.commits.length} commits and ${mergeData.fileChanges.length} file changes`);

    // Analyze the merge for testability
    core.info('Analyzing merge for testability...');
    const analysis = await analyzeMerge(
      inputs.apiKey,
      inputs.apiUrl,
      mergeData.commits,
      mergeData.fileChanges,
      mergeData.diffContent,
      inputs.testUrl!,
      prContext?.title,
      prContext?.body,
      inputs.githubRepo
    );
    result.analysis = analysis;

    if (!analysis.isTestable) {
      core.info(`Merge is not testable: ${analysis.reason}`);
      result.status = 'skipped';
      result.skipReason = analysis.reason || 'Changes not testable by human';
      return result;
    }

    core.info(`Merge is testable (confidence: ${analysis.confidence})`);
    core.info(`Summary: ${analysis.summary}`);
    core.info(`Affected areas: ${analysis.affectedAreas.join(', ')}`);

    // Run the QA test
    core.info(`Running QA test for merge on ${inputs.testUrl}...`);
    const testResult = await runMergeTest(
      inputs.apiKey,
      inputs.apiUrl,
      analysis,
      inputs.testUrl!,
      inputs.targetDurationMinutes,
      prContext,
      inputs.githubRepo
    );
    result.testResult = testResult;
    result.status = 'tested';
    result.passed = testResult.result?.success ?? false;

    // Track cost
    if (testResult.costUsd) {
      results.totalCostUsd += testResult.costUsd;
    }

    if (result.passed) {
      core.info('Merge test PASSED');
    } else {
      core.info('Merge test FAILED');
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.warning(`Error processing merge test: ${errorMessage}`);

    result.status = 'error';
    result.error = errorMessage;
    return result;
  }
}

/**
 * Set action outputs
 */
function setOutputs(results: ActionResults): void {
  core.setOutput('tested-issues', JSON.stringify(results.testedIssues));
  core.setOutput('passed-issues', JSON.stringify(results.passedIssues));
  core.setOutput('failed-issues', JSON.stringify(results.failedIssues));
  core.setOutput('skipped-issues', JSON.stringify(results.skippedIssues));
  core.setOutput('total-cost-usd', results.totalCostUsd.toFixed(4));
  core.setOutput('results', JSON.stringify(results.results));
}

/**
 * Create a workflow summary
 */
async function createSummary(results: ActionResults): Promise<void> {
  const summary = core.summary;

  summary.addHeading('Issue Test Results', 2);

  // Overview table
  summary.addTable([
    [
      { data: 'Metric', header: true },
      { data: 'Count', header: true },
    ],
    ['Tested', String(results.testedIssues.length)],
    ['Passed', String(results.passedIssues.length)],
    ['Failed', String(results.failedIssues.length)],
    ['Skipped', String(results.skippedIssues.length)],
    ['Total Cost', `$${results.totalCostUsd.toFixed(4)}`],
  ]);

  // Details for each issue
  if (results.results.length > 0) {
    summary.addHeading('Details', 3);

    for (const result of results.results) {
      const statusEmoji =
        result.status === 'tested'
          ? result.passed
            ? '\u2705'
            : '\u274C'
          : result.status === 'skipped'
            ? '\u23ED\uFE0F'
            : '\u26A0\uFE0F';

      summary.addRaw(`${statusEmoji} **Issue #${result.issueNumber}**: `);

      if (result.status === 'tested') {
        summary.addRaw(result.passed ? 'Passed' : 'Failed');
        if (result.testResult?.costUsd) {
          summary.addRaw(` ($${result.testResult.costUsd.toFixed(4)})`);
        }
      } else if (result.status === 'skipped') {
        summary.addRaw(`Skipped - ${result.skipReason}`);
      } else {
        summary.addRaw(`Error - ${result.error}`);
      }

      summary.addEOL();
    }
  }

  summary.addRaw('\n---\n');
  summary.addRaw('Powered by [Runhuman](https://runhuman.com)');

  await summary.write();
}

/**
 * Create a workflow summary for merge tests (no issues)
 */
async function createMergeSummary(results: ActionResults, mergeResult: MergeTestResult): Promise<void> {
  const summary = core.summary;

  summary.addHeading('Merge Test Results', 2);

  const statusEmoji =
    mergeResult.status === 'tested'
      ? mergeResult.passed
        ? '\u2705'
        : '\u274C'
      : mergeResult.status === 'skipped'
        ? '\u23ED\uFE0F'
        : '\u26A0\uFE0F';

  // Overview
  summary.addRaw(`**Status:** ${statusEmoji} `);
  if (mergeResult.status === 'tested') {
    summary.addRaw(mergeResult.passed ? 'Passed' : 'Failed');
  } else if (mergeResult.status === 'skipped') {
    summary.addRaw(`Skipped - ${mergeResult.skipReason}`);
  } else {
    summary.addRaw(`Error - ${mergeResult.error}`);
  }
  summary.addEOL();
  summary.addEOL();

  // Cost if available
  if (mergeResult.testResult?.costUsd) {
    summary.addRaw(`**Cost:** $${mergeResult.testResult.costUsd.toFixed(4)}`);
    summary.addEOL();
  }

  // Analysis summary if available
  if (mergeResult.analysis) {
    summary.addHeading('Analysis', 3);
    summary.addRaw(`**Summary:** ${mergeResult.analysis.summary}`);
    summary.addEOL();
    if (mergeResult.analysis.affectedAreas.length > 0) {
      summary.addRaw(`**Affected Areas:** ${mergeResult.analysis.affectedAreas.join(', ')}`);
      summary.addEOL();
    }
    summary.addRaw(`**Confidence:** ${(mergeResult.analysis.confidence * 100).toFixed(0)}%`);
    summary.addEOL();
  }

  // Test result details if available
  if (mergeResult.testResult?.result) {
    summary.addHeading('Test Result', 3);
    summary.addRaw(`**Explanation:** ${mergeResult.testResult.result.explanation}`);
    summary.addEOL();
  }

  summary.addRaw('\n---\n');
  summary.addRaw('Powered by [Runhuman](https://runhuman.com)');

  await summary.write();
}

// Run the action
run();
