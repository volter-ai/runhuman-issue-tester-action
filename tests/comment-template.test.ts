import { describe, it, expect } from 'vitest';
import { buildTestResultComment } from '../src/templates/comment-template';
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

  it('should build a passing test comment', () => {
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

    expect(comment).toContain('QA Test PASSED');
    expect(comment).toContain('https://staging.example.com');
    expect(comment).toContain('120s');
    expect(comment).toContain('$0.2500');
    expect(comment).toContain('95%');
    expect(comment).toContain('The login button works correctly now.');
    expect(comment).toContain('Test passed. Issue confirmed as resolved.');
    expect(comment).toContain('RunHuman');
  });

  it('should build a failing test comment', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: false,
        explanation: 'The login button still does not respond on mobile.',
        data: { issueResolved: false },
      },
      costUsd: 0.30,
      testDurationSeconds: 180,
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('QA Test FAILED');
    expect(comment).toContain('The login button still does not respond on mobile.');
    expect(comment).toContain('This issue has been reopened because the QA test failed.');
  });

  it('should include screenshots when available', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      testerData: {
        testDurationSeconds: 100,
        screenshots: ['https://example.com/screenshot1.png', 'https://example.com/screenshot2.png'],
        consoleMessages: [],
        networkRequests: [],
        clicks: [],
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('### Screenshots');
    expect(comment).toContain('![Screenshot 1](https://example.com/screenshot1.png)');
    expect(comment).toContain('![Screenshot 2](https://example.com/screenshot2.png)');
  });

  it('should include video link when available', () => {
    const testResult: QATestResponse = {
      status: 'completed',
      result: {
        success: true,
        explanation: 'Test passed.',
        data: {},
      },
      testerData: {
        testDurationSeconds: 100,
        screenshots: [],
        videoUrl: 'https://example.com/recording.mp4',
        consoleMessages: [],
        networkRequests: [],
        clicks: [],
      },
    };

    const comment = buildTestResultComment(testResult, mockAnalysis);

    expect(comment).toContain('### Session Recording');
    expect(comment).toContain('[View Video Recording](https://example.com/recording.mp4)');
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

    expect(comment).toContain('### Test Results');
    expect(comment).toContain('Yes'); // true formatted
    expect(comment).toContain('No'); // false formatted
  });
});
