export const FOLLOW_UP_TYPES = ['CALL', 'VISIT', 'MEETING'] as const;

export type FollowUpTypeValue = (typeof FOLLOW_UP_TYPES)[number];

export const normalizeFollowUpType = (value: unknown): FollowUpTypeValue => {
  if (typeof value !== 'string') return 'CALL';
  const upper = value.trim().toUpperCase();
  if (upper === 'VISIT' || upper === 'MEETING' || upper === 'CALL') {
    return upper;
  }
  return 'CALL';
};
