import type { QATestResponse, AnalyzeIssueResponse } from '../types';

/**
 * Build a markdown comment for posting test results to a GitHub issue
 */
export function buildTestResultComment(
  testResult: QATestResponse,
  analysis: AnalyzeIssueResponse
): string {
  const passed = testResult.result?.success ?? false;
  const statusEmoji = passed ? '\u2705' : '\u274C';
  const statusText = passed ? 'PASSED' : 'FAILED';

  let comment = `## ${statusEmoji} QA Test ${statusText}

**Tested URL:** ${analysis.testUrl || 'N/A'}
**Duration:** ${testResult.testDurationSeconds ? `${testResult.testDurationSeconds}s` : 'N/A'}
**Cost:** ${testResult.costUsd ? `$${testResult.costUsd.toFixed(4)}` : 'N/A'}
**Confidence:** ${(analysis.confidence * 100).toFixed(0)}%

---

### Test Instructions

> ${analysis.testInstructions}

---

### Tester Findings

> ${testResult.result?.explanation || 'No explanation provided'}

`;

  // Add extracted data if available
  if (testResult.result?.data && Object.keys(testResult.result.data).length > 0) {
    comment += `
### Test Results

| Field | Value |
|-------|-------|
`;
    for (const [key, value] of Object.entries(testResult.result.data)) {
      const displayValue = formatValue(value);
      comment += `| ${key} | ${displayValue} |\n`;
    }
    comment += '\n';
  }

  // Add screenshots if available
  if (testResult.testerData?.screenshots && testResult.testerData.screenshots.length > 0) {
    comment += `
### Screenshots

`;
    for (let i = 0; i < testResult.testerData.screenshots.length; i++) {
      comment += `![Screenshot ${i + 1}](${testResult.testerData.screenshots[i]})\n\n`;
    }
  }

  // Add video link if available
  if (testResult.testerData?.videoUrl) {
    comment += `
### Session Recording

[View Video Recording](${testResult.testerData.videoUrl})

`;
  }

  // Add action taken message
  if (!passed) {
    comment += `
---

**Action Taken:** This issue has been reopened because the QA test failed.

`;
  } else {
    comment += `
---

**Action Taken:** Test passed. Issue confirmed as resolved.

`;
  }

  // Footer
  comment += `
---

<sub>Powered by [RunHuman](https://runhuman.com) - Human-powered QA testing</sub>
`;

  return comment;
}

/**
 * Format a value for display in the results table
 */
function formatValue(value: unknown): string {
  if (value === true) return '\u2705 Yes';
  if (value === false) return '\u274C No';
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'object') return `\`${JSON.stringify(value)}\``;
  return String(value);
}
