import type { Feature } from '@/features/types';
import { populateDeliveriesJob } from './jobs';

export const deliveriesFeature: Feature = {
  id: 'deliveries',
  stack: {
    label: 'Deliveries',
    icon: 'Package',
    href: '/deliveries',
    description: 'Upcoming deliveries from Gmail',
    dashboardWidget: false, // the dashboard has a dedicated Deliveries widget (registry.json)
    chatTools: [],
  },
  jobs: { 'populate-deliveries': populateDeliveriesJob },
};
