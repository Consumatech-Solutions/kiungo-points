// Copied from the AMU engine (packages/core/test/periods.test.ts, ADR-002), with Kiungo's period names and the quarter.
import { describe, it, expect } from 'vitest';
import { periodKey, periodOrdinal, isValidTimezone } from '../src/points/periods';

describe('periodKey', () => {
  it('once is always the constant bucket', () => {
    expect(periodKey('2026-07-26T23:30:00Z', 'once', 'UTC')).toBe('once');
  });
  it('daily label is local to the person\'s time zone', () => {
    // 23:30Z on the 26th is 00:30 on the 27th in Lagos (UTC+1)
    expect(periodKey('2026-07-26T23:30:00Z', 'daily', 'Africa/Lagos')).toBe('2026-07-27');
    expect(periodKey('2026-07-26T23:30:00Z', 'daily', 'UTC')).toBe('2026-07-26');
  });
  it('monthly label is local year-month', () => {
    expect(periodKey('2026-07-31T23:30:00Z', 'monthly', 'Africa/Lagos')).toBe('2026-08');
  });
  it('quarterly label is local year-quarter', () => {
    expect(periodKey('2026-09-30T23:30:00Z', 'quarterly', 'Africa/Kinshasa')).toBe('2026-Q4');
    expect(periodKey('2026-09-30T23:30:00Z', 'quarterly', 'UTC')).toBe('2026-Q3');
  });
  it('weekly label is ISO week (Monday start)', () => {
    // 2026-01-01 is a Thursday => ISO 2026-W01
    expect(periodKey('2026-01-01T12:00:00Z', 'weekly', 'UTC')).toBe('2026-W01');
    // 2021-01-01 is a Friday => ISO week belongs to 2020-W53
    expect(periodKey('2021-01-01T12:00:00Z', 'weekly', 'UTC')).toBe('2020-W53');
  });
});

describe('periodOrdinal', () => {
  it('consecutive days differ by exactly 1, across a month boundary', () => {
    const a = periodOrdinal('2026-07-31T12:00:00Z', 'daily', 'UTC');
    const b = periodOrdinal('2026-08-01T12:00:00Z', 'daily', 'UTC');
    expect(b - a).toBe(1);
  });
  it('is timezone-aware for the day boundary', () => {
    const a = periodOrdinal('2026-07-26T23:30:00Z', 'daily', 'Africa/Lagos'); // 27th local
    const b = periodOrdinal('2026-07-27T10:00:00Z', 'daily', 'Africa/Lagos'); // 27th local
    expect(b - a).toBe(0);
  });
  it('consecutive weeks differ by 1 across a year boundary', () => {
    const a = periodOrdinal('2020-12-31T12:00:00Z', 'weekly', 'UTC'); // 2020-W53
    const b = periodOrdinal('2021-01-04T12:00:00Z', 'weekly', 'UTC'); // 2021-W01
    expect(b - a).toBe(1);
  });
  it('ISO week 53 of 2026 and week 1 of 2027 are consecutive', () => {
    const a = periodOrdinal('2026-12-30T12:00:00Z', 'weekly', 'Africa/Kinshasa'); // 2026-W53
    const b = periodOrdinal('2027-01-06T12:00:00Z', 'weekly', 'Africa/Kinshasa'); // 2027-W01
    expect(periodKey('2026-12-30T12:00:00Z', 'weekly', 'Africa/Kinshasa')).toBe('2026-W53');
    expect(b - a).toBe(1);
  });
  it('consecutive months differ by 1 across a year boundary', () => {
    const a = periodOrdinal('2026-12-15T12:00:00Z', 'monthly', 'UTC');
    const b = periodOrdinal('2027-01-15T12:00:00Z', 'monthly', 'UTC');
    expect(b - a).toBe(1);
  });
  it('survives a DST transition as consecutive days', () => {
    // US spring-forward 2026-03-08
    const a = periodOrdinal('2026-03-08T12:00:00Z', 'daily', 'America/New_York');
    const b = periodOrdinal('2026-03-09T12:00:00Z', 'daily', 'America/New_York');
    expect(b - a).toBe(1);
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('Africa/Lagos')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });
});
