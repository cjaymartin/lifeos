import { describe, it, expect } from 'vitest';
import {
  daysUntil,
  describeBirthdays,
  anyImminent,
  birthdaysToday,
  IMMINENT_WITHIN_DAYS,
  type Birthday,
} from '@/lib/birthdays';

const TODAY = '2026-06-12';

describe('daysUntil', () => {
  it('is 0 for today', () => {
    expect(daysUntil('2026-06-12', TODAY)).toBe(0);
  });

  it('counts whole days forward', () => {
    expect(daysUntil('2026-06-13', TODAY)).toBe(1);
    expect(daysUntil('2026-06-19', TODAY)).toBe(7);
  });

  it('crosses month boundaries correctly', () => {
    expect(daysUntil('2026-07-02', TODAY)).toBe(20);
  });

  it('is negative for past dates', () => {
    expect(daysUntil('2026-06-11', TODAY)).toBe(-1);
  });

  it('is immune to DST shifts (whole-day count)', () => {
    // Spring-forward weekend in America/New_York is 2026-03-08
    expect(daysUntil('2026-03-09', '2026-03-07')).toBe(2);
  });
});

describe('describeBirthdays', () => {
  const data: Birthday[] = [
    { name: 'Amanda', date: '2026-06-22' },
    { name: 'Anna', date: '2026-06-19' },
  ];

  it('sorts ascending by date and attaches daysUntil', () => {
    const views = describeBirthdays(data, TODAY);
    expect(views.map((v) => v.name)).toEqual(['Anna', 'Amanda']);
    expect(views.map((v) => v.daysUntil)).toEqual([7, 10]);
  });

  it('drops birthdays already in the past', () => {
    const views = describeBirthdays(
      [{ name: 'Past', date: '2026-06-01' }, { name: 'Anna', date: '2026-06-19' }],
      TODAY,
    );
    expect(views.map((v) => v.name)).toEqual(['Anna']);
  });

  it('labels today, tomorrow, and N days', () => {
    const views = describeBirthdays(
      [
        { name: 'A', date: '2026-06-12' },
        { name: 'B', date: '2026-06-13' },
        { name: 'C', date: '2026-06-17' },
      ],
      TODAY,
    );
    expect(views.map((v) => v.label)).toEqual(['Today', 'Tomorrow', 'in 5 days']);
  });

  it('marks isToday and imminent flags', () => {
    const views = describeBirthdays(
      [
        { name: 'Today', date: '2026-06-12' },
        { name: 'Tmrw', date: '2026-06-13' },
        { name: 'Later', date: '2026-06-19' },
      ],
      TODAY,
    );
    expect(views.map((v) => v.isToday)).toEqual([true, false, false]);
    // imminent = within 1 day (the answer: yellow the day before + day of)
    expect(views.map((v) => v.imminent)).toEqual([true, true, false]);
  });
});

describe('urgency helpers', () => {
  it('IMMINENT_WITHIN_DAYS is 1 (day-before + day-of)', () => {
    expect(IMMINENT_WITHIN_DAYS).toBe(1);
  });

  it('anyImminent is true only when something is within the threshold', () => {
    expect(anyImminent(describeBirthdays([{ name: 'X', date: '2026-06-13' }], TODAY))).toBe(true);
    expect(anyImminent(describeBirthdays([{ name: 'X', date: '2026-06-19' }], TODAY))).toBe(false);
    expect(anyImminent([])).toBe(false);
  });

  it('birthdaysToday returns only same-day birthdays (drives the banner)', () => {
    const views = describeBirthdays(
      [
        { name: 'Party', date: '2026-06-12' },
        { name: 'Also', date: '2026-06-12' },
        { name: 'Tmrw', date: '2026-06-13' },
      ],
      TODAY,
    );
    expect(birthdaysToday(views).map((v) => v.name)).toEqual(['Party', 'Also']);
  });
});
