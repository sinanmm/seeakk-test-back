export type DashboardItemType = 'CARD' | 'SECTION';

export interface DashboardDefaultItem {
  key: string;
  type: DashboardItemType;
  defaultTitle: string;
  defaultOrder: number;
  defaultVisible: boolean;
}

export const DEFAULT_DASHBOARD_CARDS: DashboardDefaultItem[] = [
  {
    key: 'today_leads',
    type: 'CARD',
    defaultTitle: "Today's Leads",
    defaultOrder: 1,
    defaultVisible: true,
  },
  {
    key: 'total_leads',
    type: 'CARD',
    defaultTitle: 'Total Leads',
    defaultOrder: 2,
    defaultVisible: true,
  },
  {
    key: 'closed_leads',
    type: 'CARD',
    defaultTitle: 'Closed Leads',
    defaultOrder: 3,
    defaultVisible: true,
  },
  {
    key: 'expected_revenue',
    type: 'CARD',
    defaultTitle: 'Expected Revenue',
    defaultOrder: 4,
    defaultVisible: true,
  },
  {
    key: 'revenue',
    type: 'CARD',
    defaultTitle: 'Revenue',
    defaultOrder: 5,
    defaultVisible: true,
  },
  {
    key: 'total_advance',
    type: 'CARD',
    defaultTitle: 'Total Advance',
    defaultOrder: 6,
    defaultVisible: true,
  },
  {
    key: 'active_users',
    type: 'CARD',
    defaultTitle: 'Active Users',
    defaultOrder: 7,
    defaultVisible: true,
  },
];

export const DEFAULT_DASHBOARD_SECTIONS: DashboardDefaultItem[] = [
  {
    key: 'followup_capacity',
    type: 'SECTION',
    defaultTitle: 'Daily Follow-Up Capacity',
    defaultOrder: 1,
    defaultVisible: true,
  },
  {
    key: 'growth_and_pipeline',
    type: 'SECTION',
    defaultTitle: 'Growth Velocity & Pipeline Stages',
    defaultOrder: 2,
    defaultVisible: true,
  },
  {
    key: 'product_performance',
    type: 'SECTION',
    defaultTitle: 'Product Performance',
    defaultOrder: 3,
    defaultVisible: true,
  },
  {
    key: 'recent_activity',
    type: 'SECTION',
    defaultTitle: 'Recent Activity',
    defaultOrder: 4,
    defaultVisible: true,
  },
  {
    key: 'lob_analysis',
    type: 'SECTION',
    defaultTitle: 'LOB Analysis',
    defaultOrder: 5,
    defaultVisible: true,
  },
  {
    key: 'calendar_widget',
    type: 'SECTION',
    defaultTitle: 'Calendar & Reminders',
    defaultOrder: 6,
    defaultVisible: true,
  },
];

export const ALL_DEFAULT_DASHBOARD_ITEMS: DashboardDefaultItem[] = [
  ...DEFAULT_DASHBOARD_CARDS,
  ...DEFAULT_DASHBOARD_SECTIONS,
];
