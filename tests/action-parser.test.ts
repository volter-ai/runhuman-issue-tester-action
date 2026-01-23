import { describe, it, expect } from 'vitest';
import { parseActions } from '../src/actions/action-parser';

describe('parseActions', () => {
  describe('simple actions', () => {
    it('should parse close action', () => {
      const result = parseActions('close');
      expect(result).toEqual([{ type: 'close' }]);
    });

    it('should parse open action', () => {
      const result = parseActions('open');
      expect(result).toEqual([{ type: 'open' }]);
    });

    it('should parse comment action', () => {
      const result = parseActions('comment');
      expect(result).toEqual([{ type: 'comment' }]);
    });
  });

  describe('actions with values', () => {
    it('should parse add-label with simple value', () => {
      const result = parseActions('add-label:bug');
      expect(result).toEqual([{ type: 'add-label', value: 'bug' }]);
    });

    it('should parse remove-label with simple value', () => {
      const result = parseActions('remove-label:qa-failed');
      expect(result).toEqual([{ type: 'remove-label', value: 'qa-failed' }]);
    });

    it('should parse add-label with quoted value containing colon', () => {
      const result = parseActions('add-label:"stage: QA"');
      expect(result).toEqual([{ type: 'add-label', value: 'stage: QA' }]);
    });

    it('should parse remove-label with quoted value containing spaces', () => {
      const result = parseActions('remove-label:"needs review"');
      expect(result).toEqual([{ type: 'remove-label', value: 'needs review' }]);
    });
  });

  describe('multiple actions', () => {
    it('should parse multiple simple actions', () => {
      const result = parseActions('close comment');
      expect(result).toEqual([{ type: 'close' }, { type: 'comment' }]);
    });

    it('should parse close with add-label', () => {
      const result = parseActions('close add-label:released');
      expect(result).toEqual([{ type: 'close' }, { type: 'add-label', value: 'released' }]);
    });

    it('should parse complex action string with quotes', () => {
      const result = parseActions('close remove-label:"stage: QA" add-label:"stage: Released"');
      expect(result).toEqual([
        { type: 'close' },
        { type: 'remove-label', value: 'stage: QA' },
        { type: 'add-label', value: 'stage: Released' },
      ]);
    });

    it('should parse open with multiple label actions', () => {
      const result = parseActions('open remove-label:"stage: QA" add-label:"stage: In Progress"');
      expect(result).toEqual([
        { type: 'open' },
        { type: 'remove-label', value: 'stage: QA' },
        { type: 'add-label', value: 'stage: In Progress' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty string', () => {
      const result = parseActions('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace', () => {
      const result = parseActions('   ');
      expect(result).toEqual([]);
    });

    it('should return empty array for null/undefined', () => {
      expect(parseActions(null as unknown as string)).toEqual([]);
      expect(parseActions(undefined as unknown as string)).toEqual([]);
    });

    it('should handle extra whitespace between actions', () => {
      const result = parseActions('  close   add-label:bug  ');
      expect(result).toEqual([{ type: 'close' }, { type: 'add-label', value: 'bug' }]);
    });
  });

  describe('error handling', () => {
    it('should throw for unknown action', () => {
      expect(() => parseActions('invalid-action')).toThrow('Unknown action: "invalid-action"');
    });

    it('should throw for add-label without value', () => {
      expect(() => parseActions('add-label:')).toThrow('add-label requires a value');
    });

    it('should throw for remove-label without value', () => {
      expect(() => parseActions('remove-label:')).toThrow('remove-label requires a value');
    });
  });
});
