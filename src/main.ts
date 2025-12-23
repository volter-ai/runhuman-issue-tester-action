import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseInputs } from './input-parser';
import { getLinkedIssues, getIssueByNumber, hasLabel, findMergedPRForCommit, getIssuesFromCommitMessage } from './github/linked-issues';
import { getPRContext } from './github/pr-context';
import { postTestResultComment } from './github/issue-commenter';
import { reopenIssue, addLabel, removeLabel, ensureIssueClosed } from './github/issue-manager';
import { analyzeIssue } from './api/analyze-issue';
import { runQATest } from './api/run-test';
import type { ActionResults, IssueTestResult, LinkedIssue, PRContext } from './types';

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

    // 2. Determine mode: manual (issue-number) or PR merge
    if (inputs.issueNumber !== null) {
      // Manual mode: test specific issue (no PR context available)
      core.info(`Manual mode: Testing issue #${inputs.issueNumber}`);
      const issue = await getIssueByNumber(inputs.githubToken, inputs.issueNumber);

      if (!issue) {
        core.setFailed(`Issue #${inputs.issueNumber} not found or is a pull request`);
        return;
      }

      issuesToProcess = [issue];
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
        core.info('No linked issues found, nothing to test');
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

    // Analyze the issue with AI (pass preset URL if provided)
    core.info(`Analyzing issue #${issue.number}...`);
    const analysis = await analyzeIssue(
      inputs.apiKey,
      inputs.apiUrl,
      issue,
      inputs.testUrl || undefined
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
      prContext
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

      // Ensure issue is closed and remove failure label
      await ensureIssueClosed(inputs.githubToken, issue.number);
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
  summary.addRaw('Powered by [RunHuman](https://runhuman.com)');

  await summary.write();
}

// Run the action
run();
