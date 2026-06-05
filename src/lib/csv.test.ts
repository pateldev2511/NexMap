import { describe, it, expect } from 'vitest';
import { parseCsv, detectDelimiter } from './csv';

describe('parseCsv', () => {
  it('parses simple comma CSV', () => {
    const { headers, rows } = parseCsv('name,type\nR1,router\nSW1,switch');
    expect(headers).toEqual(['name', 'type']);
    expect(rows).toEqual([
      { name: 'R1', type: 'router' },
      { name: 'SW1', type: 'switch' },
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    const { headers } = parseCsv('﻿name,type\nR1,router');
    expect(headers).toEqual(['name', 'type']);
  });

  it('handles quoted fields with embedded commas', () => {
    const { rows } = parseCsv('name,notes\nR1,"core, primary"');
    expect(rows[0]).toEqual({ name: 'R1', notes: 'core, primary' });
  });

  it('handles escaped quotes', () => {
    const { rows } = parseCsv('name,notes\nR1,"say ""hi"""');
    expect(rows[0]!.notes).toBe('say "hi"');
  });

  it('handles embedded newlines inside quotes', () => {
    const { rows } = parseCsv('name,notes\nR1,"line1\nline2"');
    expect(rows[0]!.notes).toBe('line1\nline2');
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseCsv('name,type\r\nR1,router\r\n');
    expect(rows).toEqual([{ name: 'R1', type: 'router' }]);
  });

  it('auto-detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(parseCsv('name;type\nR1;router').rows[0]).toEqual({
      name: 'R1',
      type: 'router',
    });
  });

  it('ignores blank lines', () => {
    const { rows } = parseCsv('name\n\nR1\n\n');
    expect(rows).toEqual([{ name: 'R1' }]);
  });

  it('returns empty for an empty document', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], delimiter: ',' });
  });

  it('does not let delimiter detection be fooled by commas inside quotes', () => {
    expect(detectDelimiter('"a,b,c";d')).toBe(';');
  });
});
