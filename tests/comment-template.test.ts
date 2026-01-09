import { describe, it, expect } from 'vitest';
import { buildTestResultComment, buildJobFailedComment } from '@runhuman/shared';
import type { QATestResponse, AnalyzeIssueResponse } from '../src/types';

describe('buildTestResultComment', () => {
  const mockAnalysis: AnalyzeIssueResponse = {
    isTestable: true,
    testUrl: 'https://staging.example.com',
    testInstructions: 'Test the login flow by entering credentials and clicking submit.',
    outputSchema: {
      issueResolved: { type: 'boolean', description: 'Is the issue resolved?' },
    },
    confidence: 0.95,
  };

  it('should build a passing test comment with unicode checkmark', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'The login button works correctly now.',
        data: { issueResolved: true },
      },
      costUsd: 0.25,
      testDurationSeconds: 120,
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    // Should use unicode checkmark instead of emoji
    expect(comment).toContain('QA Test ✓ Passed');
    expect(comment).not.toContain('PASSED');
    expect(comment).toContain('https://staging.example.com');
    expect(comment).toContain('The login button works correctly now.');
    expect(comment).toContain('Test passed. Issue confirmed as resolved.');
    expect(comment).toContain('Runhuman');
  });

  it('should NOT include duration, cost, or confidence', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      costUsd: 0.25,
      testDurationSeconds: 120,
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    // These fields should NOT appear in the new format
    expect(comment).not.toContain('Duration');
    expect(comment).not.toContain('120s');
    expect(comment).not.toContain('Cost');
    expect(comment).not.toContain('$0.2500');
    expect(comment).not.toContain('Confidence');
    expect(comment).not.toContain('95%');
  });

  it('should build a failing test comment with unicode X', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: false,
        explanation: 'The login button still does not respond on mobile.',
        data: { issueResolved: false },
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    // Should use unicode X instead of emoji
    expect(comment).toContain('QA Test ✗ Failed');
    expect(comment).not.toContain('FAILED');
    expect(comment).toContain('The login button still does not respond on mobile.');
    expect(comment).toContain('This issue has been reopened because the QA test failed.');
  });

  it('should include tester info when available', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      testerAlias: 'Alex',
      testerAvatarUrl: 'https://example.com/avatar.png',
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('Tester:');
    expect(comment).toContain('Alex');
    expect(comment).toContain('https://example.com/avatar.png');
  });

  it('should include screenshots with limit of 3', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      testerData: {
        testDurationSeconds: 100,
        screenshots: [
          'https://example.com/screenshot1.png',
          'https://example.com/screenshot2.png',
          'https://example.com/screenshot3.png',
          'https://example.com/screenshot4.png',
          'https://example.com/screenshot5.png',
        ],
        consoleMessages: [],
        networkRequests: [],
        clicks: [],
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    // Should include first 3 screenshots
    expect(comment).toContain('![Screenshot 1](https://example.com/screenshot1.png)');
    expect(comment).toContain('![Screenshot 2](https://example.com/screenshot2.png)');
    expect(comment).toContain('![Screenshot 3](https://example.com/screenshot3.png)');
    // Should NOT include 4th and 5th
    expect(comment).not.toContain('screenshot4.png');
    expect(comment).not.toContain('screenshot5.png');
    // Should mention additional screenshots
    expect(comment).toContain('+2 additional screenshots');
  });

  it('should include video link before screenshots', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      testerData: {
        testDurationSeconds: 100,
        screenshots: ['https://example.com/screenshot1.png'],
        videoUrl: 'https://example.com/recording.mp4',
        consoleMessages: [],
        networkRequests: [],
        clicks: [],
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('[Watch Recording](https://example.com/recording.mp4)');
    // Video should come before screenshots in the comment
    const videoIndex = comment.indexOf('Watch Recording');
    const screenshotIndex = comment.indexOf('Screenshot 1');
    expect(videoIndex).toBeLessThan(screenshotIndex);
  });

  it('should include job link when provided', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      jobId: 'job-123',
      jobUrl: 'https://runhuman.com/dashboard/proj-1/jobs/job-123',
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('[View full details](https://runhuman.com/dashboard/proj-1/jobs/job-123)');
  });

  it('should format boolean values correctly in results table', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {
          issueResolved: true,
          hasRegressions: false,
        },
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('| issueResolved | Yes |');
    expect(comment).toContain('| hasRegressions | No |');
  });

  it('should have the correct 3-section structure', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    // Should have the 3 main sections
    expect(comment).toContain('### Test Request');
    expect(comment).toContain('### Test Results');
    expect(comment).toContain('### Action Taken');
    // Should NOT have old section names
    expect(comment).not.toContain('### Test Instructions');
    expect(comment).not.toContain('### Tester Findings');
    expect(comment).not.toContain('### Session Recording');
    expect(comment).not.toContain('### Screenshots');
  });
});

describe('buildJobFailedComment', () => {
  const mockAnalysis: AnalyzeIssueResponse = {
    isTestable: true,
    testUrl: 'https://staging.example.com',
    testInstructions: 'Test the login flow.',
    outputSchema: {},
    confidence: 0.95,
  };

  it('should build comment for abandoned job', () => {
    const testResult: QATestResponse = {
      status: 'abandoned',
      error: 'Tester left before completing the test.',
    };

    const comment = buildJobFailedComment(testResult, mockAnalysis);

    expect(comment).toContain('QA Test Could Not Be Completed');
    expect(comment).toContain('Abandoned');
    expect(comment).toContain('Tester left before completing the test.');
    expect(comment).toContain('The issue state has not been changed');
  });

  it('should build comment for error job', () => {
    const testResult: QATestResponse = {
      status: 'error',
      error: 'System timeout occurred.',
    };

    const comment = buildJobFailedComment(testResult, mockAnalysis);

    expect(comment).toContain('QA Test Could Not Be Completed');
    expect(comment).toContain('Error');
    expect(comment).toContain('System timeout occurred.');
  });

  it('should build comment for incomplete job', () => {
    const testResult: QATestResponse = {
      status: 'incomplete',
      error: 'Could not extract valid results.',
    };

    const comment = buildJobFailedComment(testResult, mockAnalysis);

    expect(comment).toContain('QA Test Could Not Be Completed');
    expect(comment).toContain('Incomplete');
    expect(comment).toContain('Could not extract valid results.');
  });

  it('should include job URL when provided', () => {
    const testResult: QATestResponse = {
      status: 'abandoned',
      jobUrl: 'https://runhuman.com/dashboard/proj-1/jobs/job-123',
    };

    const comment = buildJobFailedComment(testResult, mockAnalysis);

    expect(comment).toContain('[View details](https://runhuman.com/dashboard/proj-1/jobs/job-123)');
  });

  it('should include test request info', () => {
    const testResult: QATestResponse = {
      status: 'error',
    };

    const comment = buildJobFailedComment(testResult, mockAnalysis);

    expect(comment).toContain('### Test Request');
    expect(comment).toContain('https://staging.example.com');
    expect(comment).toContain('Test the login flow.');
  });
});
