import type { DashboardItemType } from './dashboardPreferences.constants';

export interface DashboardPreferenceItem {
  key: string;
  type: DashboardItemType;
  defaultTitle: string;
  displayTitle: string;
  customTitle?: string | null;
  displayOrder: number;
  isVisible: boolean;
}

export interface DashboardPreferencesPayload {
  cards: DashboardPreferenceItem[];
  sections: DashboardPreferenceItem[];
  canCustomize: boolean;
  canRename: boolean;
}

export interface UpdatePreferenceInputItem {
  key: string;
  type: DashboardItemType;
  isVisible: boolean;
  displayOrder: number;
  customTitle?: string | null;
}

export interface UpdateDashboardPreferencesInput {
  items: UpdatePreferenceInputItem[];
}
