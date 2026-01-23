import { describe, it, expect, vi } from 'vitest';

// Mock @actions/core before importing the module
vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
  getOctokit: vi.fn(),
}));

import { parseIssueFilter } from '../src/github/issue-filter';

describe('parseIssueFilter', () => {
  describe('basic filters', () => {
    it('should parse state:open', () => {
      const result = parseIssueFilter('state:open');
      expect(result.state).toBe('open');
    });

    it('should parse state:closed', () => {
      const result = parseIssueFilter('state:closed');
      expect(result.state).toBe('closed');
    });

    it('should default to open state', () => {
      const result = parseIssueFilter('unassigned');
      expect(result.state).toBe('open');
    });

    it('should parse unassigned flag', () => {
      const result = parseIssueFilter('unassigned');
      expect(result.unassigned).toBe(true);
    });

    it('should parse assigned:username', () => {
      const result = parseIssueFilter('assigned:johndoe');
      expect(result.assignee).toBe('johndoe');
    });
  });

  describe('label filters', () => {
    it('should parse simple label', () => {
      const result = parseIssueFilter('label:bug');
      expect(result.labels).toEqual(['bug']);
    });

    it('should parse multiple labels with comma', () => {
      const result = parseIssueFilter('label:bug,enhancement');
      expect(result.labels).toEqual(['bug', 'enhancement']);
    });

    it('should parse quoted label with colon', () => {
      const result = parseIssueFilter('label:"stage: QA"');
      expect(result.labels).toEqual(['stage: QA']);
    });

    it('should parse quoted label with spaces', () => {
      const result = parseIssueFilter('label:"needs review"');
      expect(result.labels).toEqual(['needs review']);
    });

    it('should parse quoted label with colon and spaces combined with other filters', () => {
      const result = parseIssueFilter('state:open label:"stage: QA" unassigned');
      expect(result.state).toBe('open');
      expect(result.labels).toEqual(['stage: QA']);
      expect(result.unassigned).toBe(true);
    });

    it('should handle multiple quoted labels in sequence', () => {
      // Note: This tests that tokenization works correctly with multiple quoted values
      const result = parseIssueFilter('label:"in progress" state:closed');
      expect(result.labels).toEqual(['in progress']);
      expect(result.state).toBe('closed');
    });
  });

  describe('date filters', () => {
    it('should parse age:>30d', () => {
      const result = parseIssueFilter('age:>30d');
      expect(result.ageGreaterThanDays).toBe(30);
    });

    it('should parse stale:7d', () => {
      const result = parseIssueFilter('stale:7d');
      expect(result.staleDays).toBe(7);
    });

    it('should parse active:14d', () => {
      const result = parseIssueFilter('active:14d');
      expect(result.activeDays).toBe(14);
    });
  });

  describe('media filters', () => {
    it('should parse no-media flag', () => {
      const result = parseIssueFilter('no-media');
      expect(result.noMedia).toBe(true);
    });

    it('should parse no-screenshots flag', () => {
      const result = parseIssueFilter('no-screenshots');
      expect(result.noScreenshots).toBe(true);
    });

    it('should parse no-video flag', () => {
      const result = parseIssueFilter('no-video');
      expect(result.noVideo).toBe(true);
    });
  });

  describe('complex filter combinations', () => {
    it('should parse multiple filters together', () => {
      const result = parseIssueFilter('state:open stale:30d unassigned label:bug');
      expect(result.state).toBe('open');
      expect(result.staleDays).toBe(30);
      expect(result.unassigned).toBe(true);
      expect(result.labels).toEqual(['bug']);
    });

    it('should handle the real-world "stage: QA" use case', () => {
      const result = parseIssueFilter('state:open label:"stage: QA"');
      expect(result.state).toBe('open');
      expect(result.labels).toEqual(['stage: QA']);
    });

    it('should handle quoted label at the end of filter string', () => {
      const result = parseIssueFilter('state:open unassigned label:"needs testing"');
      expect(result.state).toBe('open');
      expect(result.unassigned).toBe(true);
      expect(result.labels).toEqual(['needs testing']);
    });

    it('should handle quoted label at the start of filter string', () => {
      const result = parseIssueFilter('label:"stage: QA" state:open');
      expect(result.labels).toEqual(['stage: QA']);
      expect(result.state).toBe('open');
    });
  });

  describe('edge cases', () => {
    it('should handle empty filter', () => {
      const result = parseIssueFilter('');
      expect(result.state).toBe('open');
      expect(result.labels).toBeUndefined();
    });

    it('should handle whitespace-only filter', () => {
      const result = parseIssueFilter('   ');
      expect(result.state).toBe('open');
    });

    it('should handle filter with extra whitespace', () => {
      const result = parseIssueFilter('  state:open   label:bug  ');
      expect(result.state).toBe('open');
      expect(result.labels).toEqual(['bug']);
    });
  });
});
