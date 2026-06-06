import type { Feature } from '@/features/types';

/**
 * Settings is a feature without a sidebar stack entry — the Sidebar renders
 * its gear link separately, and account verify/re-login jobs are per-account
 * locked tasks (see ops/verify-runner.ts) rather than named agent jobs.
 */
export const settingsFeature: Feature = {
  id: 'settings',
};
