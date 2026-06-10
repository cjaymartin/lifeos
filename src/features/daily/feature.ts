import type { Feature } from '@/features/types';
import { populateDailyJob } from './jobs';

/** Widgets-only feature: the dashboard briefing (no sidebar stack). */
export const dailyFeature: Feature = {
  id: 'daily',
  jobs: { 'populate-daily': populateDailyJob },
  hasChatGuide: true, // chat.md guides the dashboard assistant's briefing answers
};
