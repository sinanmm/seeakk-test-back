export type TelephonyProviderKey = 'DEVICE_DIALER' | 'KNOWLARITY' | 'PLIVO' | 'EXOTEL';

export interface ProviderCapabilities {
  inboundCalling: boolean;
  outboundCalling: boolean;
  callRecording: boolean;
  recordingWebhooks: boolean;
  callStatusWebhooks: boolean;
  internationalCalling: boolean;
}

export interface InitiateCallParams {
  workspaceId: string;
  leadId: string;
  userId: string;
  fromNumber?: string;
  toNumber: string;
  cleanPhone: string;
  sourceContext?: string;
  recordingEnabled?: boolean;
}

export interface CallResult {
  providerCallId?: string;
  status: 'INITIATED' | 'RINGING' | 'ANSWERED' | 'COMPLETED' | 'FAILED';
  telUrl?: string;
  message?: string;
  rawResponse?: any;
}

export interface NormalizedCallEvent {
  providerCallId: string;
  event: 'STARTED' | 'RINGING' | 'ANSWERED' | 'COMPLETED' | 'FAILED' | 'RECORDING_READY';
  fromNumber?: string;
  toNumber?: string;
  status?: string;
  duration?: number;
  startedAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
  recordingAvailable?: boolean;
  recordingUrl?: string;
  recordingDuration?: number;
  recordingStatus?: 'PENDING' | 'READY' | 'FAILED' | 'UNAVAILABLE';
}

export interface TelephonyProviderConfigData {
  providerKey: TelephonyProviderKey;
  providerName: string;
  enabled: boolean;
  apiKey?: string;
  apiSecret?: string;
  accountId?: string;
  authToken?: string;
  virtualNumber?: string;
  callerId?: string;
  webhookSecret?: string;
  customSettingsJson?: string;
}

export interface TelephonySettingsData {
  activeProvider: TelephonyProviderKey;
  recordingEnabled: boolean;
  recordOutbound: boolean;
  recordInbound: boolean;
  recordingStorage: 'PROVIDER_STORAGE' | 'SEEAKK_STORAGE';
  retentionMonths: number;
}
