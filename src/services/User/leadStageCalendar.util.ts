export type StageCalendarMeta = {
  id: string;
  name: string;
  color: string;
  stageShortForm?: string | null;
  showInCalendar?: boolean;
};

export const normalizeStageShortForm = (value?: string | null): string | null => {
  const normalized = (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return null;
  return normalized.slice(0, 10);
};

export const isValidStageShortForm = (value: string): boolean => /^[A-Z0-9]{1,10}$/.test(value);

export const buildStageCalendarIndex = (stages: StageCalendarMeta[]) => {
  const byId = Object.fromEntries(stages.map((stage) => [stage.id, stage]));

  const isVisible = (stageId?: string | null): boolean => {
    if (!stageId) return false;
    return byId[stageId]?.showInCalendar !== false;
  };

  const fullName = (stageId: string, fallbackName?: string): string =>
    byId[stageId]?.name || fallbackName || 'Unknown Stage';

  const shortForm = (stageId: string): string | null => {
    const meta = byId[stageId];
    if (!meta) return null;
    return normalizeStageShortForm(meta.stageShortForm) || normalizeStageShortForm(meta.name);
  };

  const label = (stageId: string, fallbackName?: string): string => {
    const meta = byId[stageId];
    if (!meta) return (fallbackName || 'Unknown').trim();
    if (meta.showInCalendar === false) return fullName(stageId, fallbackName);
    return shortForm(stageId) || fullName(stageId, fallbackName);
  };

  const mapStageFields = (stageId: string, fallback?: { name?: string; color?: string }) => ({
    id: stageId,
    name: fullName(stageId, fallback?.name),
    stageShortForm: shortForm(stageId),
    calendarLabel: label(stageId, fallback?.name),
    color: byId[stageId]?.color || fallback?.color || '#cbd5e1',
    showInCalendar: byId[stageId]?.showInCalendar !== false,
  });

  return { byId, isVisible, fullName, shortForm, label, mapStageFields };
};
