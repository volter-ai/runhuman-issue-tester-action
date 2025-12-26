import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @actions/core before importing the module
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

import * as core from '@actions/core';
import { parseInputs } from '../src/input-parser';

describe('parseInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse valid inputs correctly', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'api-url': 'https://runhuman.com',
        'qa-label': 'qa-test',
        'auto-detect': 'false',
        'target-duration-minutes': '5',
        'reopen-on-failure': 'true',
        'failure-label': 'qa-failed',
        'remove-failure-label-on-success': 'true',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.apiKey).toBe('qa_live_test123');
    expect(result.githubToken).toBe('ghp_test');
    expect(result.apiUrl).toBe('https://runhuman.com');
    expect(result.qaLabel).toBe('qa-test');
    expect(result.autoDetect).toBe(false);
    expect(result.targetDurationMinutes).toBe(5);
    expect(result.reopenOnFailure).toBe(true);
    expect(result.failureLabel).toBe('qa-failed');
    expect(result.removeFailureLabelOnSuccess).toBe(true);
    expect(result.githubRepo).toBe('test-owner/test-repo');
  });

  it('should throw error for invalid API key format', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'invalid_key',
        'github-token': 'ghp_test',
      };
      return inputs[name] || '';
    });

    expect(() => parseInputs()).toThrow('Invalid API key format');
  });

  it('should throw error for invalid duration', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'target-duration-minutes': '100', // Invalid: > 60
      };
      return inputs[name] || '';
    });

    expect(() => parseInputs()).toThrow('target-duration-minutes must be a number between 1 and 60');
  });

  it('should use default values when optional inputs are empty', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.apiUrl).toBe('https://runhuman.com');
    expect(result.qaLabel).toBe('qa-test');
    expect(result.autoDetect).toBe(true); // Default is now true
    expect(result.targetDurationMinutes).toBe(5);
    expect(result.failureLabel).toBe('qa-failed');
  });

  it('should parse auto-detect as true when set', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'auto-detect': 'true',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.autoDetect).toBe(true);
  });

  it('should parse auto-detect as false when explicitly disabled', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'auto-detect': 'false',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.autoDetect).toBe(false);
  });

  it('should parse issue-number when provided', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'issue-number': '42',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.issueNumber).toBe(42);
  });

  it('should set issueNumber to null when not provided', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.issueNumber).toBeNull();
  });

  it('should throw error for invalid issue-number', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'issue-number': '-5',
      };
      return inputs[name] || '';
    });

    expect(() => parseInputs()).toThrow('issue-number must be a positive integer');
  });

  it('should parse test-url when provided', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'test-url': 'https://staging.example.com/login',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.testUrl).toBe('https://staging.example.com/login');
  });

  it('should parse http test-url', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'test-url': 'http://localhost:3000/test',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.testUrl).toBe('http://localhost:3000/test');
  });

  it('should set testUrl to null when not provided', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
      };
      return inputs[name] || '';
    });

    const result = parseInputs();

    expect(result.testUrl).toBeNull();
  });

  it('should throw error for invalid test-url', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'test-url': 'not-a-valid-url',
      };
      return inputs[name] || '';
    });

    expect(() => parseInputs()).toThrow('test-url must be a valid URL');
  });

  it('should throw error for non-http/https test-url', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'api-key': 'qa_live_test123',
        'github-token': 'ghp_test',
        'test-url': 'ftp://example.com/file',
      };
      return inputs[name] || '';
    });

    expect(() => parseInputs()).toThrow('test-url must be a valid URL');
  });
});
