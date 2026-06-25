import { describe, it, expect } from 'vitest';
import { selectWidgets, type WidgetDef } from '@/lib/widgets';

const w = (over: Partial<WidgetDef>): WidgetDef => ({
  id: 'x', type: 'note', label: 'X', enabled: true, order: 1,
  size: 'card', config: {}, dataKey: '', ...over,
});

const ctx = (over: Partial<Parameters<typeof selectWidgets>[1]> = {}) => ({
  daily: { date: '2026-06-03', greeting: 'hi', briefing: 'b' } as any,
  deliveriesCount: 0,
  dayOfWeek: 1, // Monday
  ...over,
});

describe('selectWidgets', () => {
  it('filters disabled widgets and sorts by order', () => {
    const { cards } = selectWidgets(
      [w({ id: 'b', order: 2 }), w({ id: 'off', enabled: false }), w({ id: 'a', order: 1 })],
      ctx(),
    );
    expect(cards.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('splits card and full widgets', () => {
    const { cards, fulls } = selectWidgets(
      [w({ id: 'c', size: 'card' }), w({ id: 'f', size: 'full' })],
      ctx(),
    );
    expect(cards.map((x) => x.id)).toEqual(['c']);
    expect(fulls.map((x) => x.id)).toEqual(['f']);
  });

  it('mon-to-trash-day shows Monday through Wednesday only', () => {
    const trash = [w({ id: 't', type: 'trash', displayCondition: 'mon-to-trash-day' })];
    expect(selectWidgets(trash, ctx({ dayOfWeek: 1 })).cards).toHaveLength(1);
    expect(selectWidgets(trash, ctx({ dayOfWeek: 3 })).cards).toHaveLength(1);
    expect(selectWidgets(trash, ctx({ dayOfWeek: 4 })).cards).toHaveLength(0);
    expect(selectWidgets(trash, ctx({ dayOfWeek: 0 })).cards).toHaveLength(0);
  });

  it('has-events requires a non-empty array at dataKey', () => {
    const cal = [w({ id: 'c', type: 'calendar', size: 'full', displayCondition: 'has-events', dataKey: 'calendar' })];
    expect(selectWidgets(cal, ctx({ daily: { calendar: [] } as any })).fulls).toHaveLength(0);
    expect(selectWidgets(cal, ctx({ daily: { calendar: [{ title: 'x' }] } as any })).fulls).toHaveLength(1);
  });

  it('has-data requires truthy data at dataKey', () => {
    const stat = [w({ id: 's', type: 'stat', displayCondition: 'has-data', dataKey: 'steps' })];
    expect(selectWidgets(stat, ctx({ daily: {} as any })).cards).toHaveLength(0);
    expect(selectWidgets(stat, ctx({ daily: { steps: 9000 } as any })).cards).toHaveLength(1);
  });

  it('has-deliveries keys off the deliveries count, not daily data', () => {
    const d = [w({ id: 'd', type: 'deliveries', displayCondition: 'has-deliveries' })];
    expect(selectWidgets(d, ctx({ deliveriesCount: 0 })).cards).toHaveLength(0);
    expect(selectWidgets(d, ctx({ deliveriesCount: 2 })).cards).toHaveLength(1);
  });

  it('no displayCondition always shows', () => {
    expect(selectWidgets([w({})], ctx({ daily: null })).cards).toHaveLength(1);
  });

  it('water-window shows from 0 to 14 days out, hidden beyond or in the past', () => {
    const now = new Date('2026-06-25T12:00:00');
    const water = (nextDate: string) =>
      [w({ id: 'wd', type: 'water-delivery', displayCondition: 'water-window', dataKey: 'water' })];
    const at = (nextDate: string) =>
      selectWidgets(water(nextDate), ctx({ now, daily: { water: { nextDate, vendor: 'ReadyRefresh' } } as any })).cards;
    expect(at('2026-06-26')).toHaveLength(1);  // tomorrow (warning)
    expect(at('2026-06-25')).toHaveLength(1);  // today
    expect(at('2026-07-09')).toHaveLength(1);  // exactly 14 days out
    expect(at('2026-07-10')).toHaveLength(0);  // 15 days — too far
    expect(at('2026-06-24')).toHaveLength(0);  // yesterday — past
  });

  it('water-window hides when there is no water data', () => {
    const wd = [w({ id: 'wd', type: 'water-delivery', displayCondition: 'water-window', dataKey: 'water' })];
    expect(selectWidgets(wd, ctx({ daily: {} as any })).cards).toHaveLength(0);
  });
});
