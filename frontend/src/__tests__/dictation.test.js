import { describe, it, expect } from 'vitest';
import { applySpokenCommands, joinDictation, matchDocType, extFor, friendlyMicError } from '../utils/dictation.js';

describe('joinDictation', () => {
  it('capitalises the first word of an empty field', () => expect(joinDictation('', 'the petitioner prays')).toBe('The petitioner prays'));
  it('adds one space and keeps case in the middle of a sentence', () => expect(joinDictation('The accused', 'was arrested on 5 May')).toBe(' was arrested on 5 May'));
  it('capitalises after a full stop', () => expect(joinDictation('Facts stated. ', 'the notice was served')).toBe('The notice was served'));
  it('capitalises after a full stop with no space and adds the space', () => expect(joinDictation('Facts stated.', 'the notice was served')).toBe(' The notice was served'));
  it('does not put a space before punctuation', () => expect(joinDictation('Delhi High Court', ', New Delhi')).toBe(', New Delhi'));
  it('adds a trailing space when text follows', () => expect(joinDictation('Hello ', 'world', 'again')).toBe('world '));
  it('flattens newlines for single-line fields', () => expect(joinDictation('', 'one\n\ntwo', '', { multiline: false })).toBe('One two'));
  it('leaves Hindi alone', () => expect(joinDictation('', 'याचिकाकर्ता')).toBe('याचिकाकर्ता'));
  it('returns nothing for blank speech', () => expect(joinDictation('abc', '   ')).toBe(''));
  it('capitalises after a danda', () => expect(joinDictation('यह सत्य है।', 'hello')).toBe(' Hello'));
});

describe('applySpokenCommands', () => {
  it('turns full stop and comma into punctuation', () => {
    expect(applySpokenCommands('The notice was served full stop The reply was late comma and incomplete full stop')).toBe('The notice was served. The reply was late, and incomplete.');
  });
  it('handles what Whisper writes around the command', () => {
    expect(applySpokenCommands('The notice was served. Full stop. Next point')).toBe('The notice was served. Next point');
  });
  it('makes paragraphs and lines', () => {
    expect(applySpokenCommands('First para new paragraph Second para new line third')).toBe('First para\n\nSecond para\nthird');
  });
  it('question mark and brackets', () => {
    expect(applySpokenCommands('Is it valid question mark open bracket see annexure A close bracket')).toBe('Is it valid? (see annexure A)');
  });
  it('does not touch the word period', () => expect(applySpokenCommands('for a period of three years')).toBe('for a period of three years'));
  it('does not touch commas inside other words', () => expect(applySpokenCommands('Commander Comma')).toContain('Commander'));
});

describe('matchDocType', () => {
  const types = [
    { id: 'affidavit', short: 'Affidavit' }, { id: 'bail', short: 'Bail application (regular)' },
    { id: 'cheque_notice', short: 'Cheque bounce notice (s.138 NI Act)' }, { id: 'amend', short: 'Contract amendment' },
    { id: 'legal_notice', short: 'Legal notice (general)' }, { id: 'nda', short: 'NDA (mutual)' },
    { id: 'plaint', short: 'Plaint (skeleton)' }, { id: 'rent', short: 'Rent agreement' },
    { id: 'reply', short: 'Reply to a legal notice' }, { id: 'sale', short: 'Sale deed' }, { id: 'vakalat', short: 'Vakalatnama' },
  ];
  const pick = (s) => matchDocType(s, types);
  it('legal notice', () => expect(pick('Draft a legal notice for recovery of dues')).toBe('legal_notice'));
  it('cheque before notice', () => expect(pick('cheque bounce legal notice under section 138')).toBe('cheque_notice'));
  it('reply before notice', () => expect(pick('draft a reply to the legal notice received')).toBe('reply'));
  it('bail', () => expect(pick('regular bail for my client')).toBe('bail'));
  it('nda', () => expect(pick('make a mutual NDA')).toBe('nda'));
  it('rent', () => expect(pick('rent agreement for a flat in Delhi')).toBe('rent'));
  it('nothing', () => expect(pick('something unusual')).toBeNull());
  it('empty and missing types', () => { expect(pick('')).toBeNull(); expect(matchDocType('bail', null)).toBeNull(); });
});

describe('small helpers', () => {
  it('extFor', () => { expect(extFor('audio/webm;codecs=opus')).toBe('webm'); expect(extFor('audio/mp4')).toBe('m4a'); expect(extFor('audio/ogg')).toBe('ogg'); expect(extFor('')).toBe('webm'); });
  it('friendlyMicError', () => {
    expect(friendlyMicError({ name: 'NotAllowedError' })).toMatch(/blocked/);
    expect(friendlyMicError({ name: 'NotFoundError' })).toMatch(/No microphone/);
    expect(friendlyMicError({ name: 'NotReadableError' })).toMatch(/busy/);
    expect(friendlyMicError(null)).toMatch(/could not start/);
  });
});
