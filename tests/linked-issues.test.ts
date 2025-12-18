import { describe, it, expect } from 'vitest';
import { parseIssueNumbersFromCommitMessage } from '../src/github/linked-issues';

describe('parseIssueNumbersFromCommitMessage', () => {
  describe('default patterns (GitHub keywords)', () => {
    it('matches "fixes #123"', () => {
      const result = parseIssueNumbersFromCommitMessage('fixes #123');
      expect(result).toEqual([123]);
    });

    it('matches "Fixes #456"', () => {
      const result = parseIssueNumbersFromCommitMessage('Fixes #456');
      expect(result).toEqual([456]);
    });

    it('matches "fixed #789"', () => {
      const result = parseIssueNumbersFromCommitMessage('fixed #789');
      expect(result).toEqual([789]);
    });

    it('matches "close #100"', () => {
      const result = parseIssueNumbersFromCommitMessage('close #100');
      expect(result).toEqual([100]);
    });

    it('matches "closes #200"', () => {
      const result = parseIssueNumbersFromCommitMessage('closes #200');
      expect(result).toEqual([200]);
    });

    it('matches "closed #300"', () => {
      const result = parseIssueNumbersFromCommitMessage('closed #300');
      expect(result).toEqual([300]);
    });

    it('matches "resolve #400"', () => {
      const result = parseIssueNumbersFromCommitMessage('resolve #400');
      expect(result).toEqual([400]);
    });

    it('matches "resolves #500"', () => {
      const result = parseIssueNumbersFromCommitMessage('resolves #500');
      expect(result).toEqual([500]);
    });

    it('matches "resolved #600"', () => {
      const result = parseIssueNumbersFromCommitMessage('resolved #600');
      expect(result).toEqual([600]);
    });

    it('matches multiple issues', () => {
      const result = parseIssueNumbersFromCommitMessage('fixes #1, closes #2, resolves #3');
      expect(result.sort()).toEqual([1, 2, 3]);
    });

    it('deduplicates issues', () => {
      const result = parseIssueNumbersFromCommitMessage('fixes #123, also fixes #123');
      expect(result).toEqual([123]);
    });

    it('returns empty array when no issues found', () => {
      const result = parseIssueNumbersFromCommitMessage('updated readme');
      expect(result).toEqual([]);
    });

    it('ignores plain # references without keywords', () => {
      const result = parseIssueNumbersFromCommitMessage('related to #123');
      expect(result).toEqual([]);
    });
  });

  describe('custom pattern', () => {
    it('matches custom pattern with capture group', () => {
      const result = parseIssueNumbersFromCommitMessage(
        'JIRA-123: some work',
        'JIRA-(\\d+)'
      );
      expect(result).toEqual([123]);
    });

    it('matches custom pattern without capture group', () => {
      const result = parseIssueNumbersFromCommitMessage(
        'issue 456 fixed',
        'issue (\\d+)'
      );
      expect(result).toEqual([456]);
    });

    it('combines default and custom patterns', () => {
      const result = parseIssueNumbersFromCommitMessage(
        'fixes #100, PROJ-200',
        'PROJ-(\\d+)'
      );
      expect(result.sort()).toEqual([100, 200]);
    });

    it('deduplicates across patterns', () => {
      const result = parseIssueNumbersFromCommitMessage(
        'fixes #123, issue-123',
        'issue-(\\d+)'
      );
      expect(result).toEqual([123]);
    });

    it('handles invalid custom pattern gracefully', () => {
      const result = parseIssueNumbersFromCommitMessage(
        'fixes #123',
        '[invalid regex('
      );
      // Should still match default pattern despite invalid custom pattern
      expect(result).toEqual([123]);
    });

    it('ignores non-numeric captures', () => {
      const result = parseIssueNumbersFromCommitMessage(
        'PROJ-abc',
        'PROJ-(\\w+)'
      );
      // Should not include NaN or invalid numbers
      expect(result).toEqual([]);
    });

    it('handles null custom pattern', () => {
      const result = parseIssueNumbersFromCommitMessage('fixes #123', null);
      expect(result).toEqual([123]);
    });

    it('handles undefined custom pattern', () => {
      const result = parseIssueNumbersFromCommitMessage('fixes #123', undefined);
      expect(result).toEqual([123]);
    });
  });
});
