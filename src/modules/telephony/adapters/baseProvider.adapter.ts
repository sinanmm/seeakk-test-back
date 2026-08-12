import {
  InitiateCallParams,
  CallResult,
  NormalizedCallEvent,
  ProviderCapabilities,
  TelephonyProviderConfigData,
} from '../telephony.types';

export abstract class BaseTelephonyProviderAdapter {
  abstract getProviderKey(): string;
  abstract getCapabilities(): ProviderCapabilities;

  abstract initiateCall(
    params: InitiateCallParams,
    config: TelephonyProviderConfigData,
  ): Promise<CallResult>;

  abstract getCallStatus(
    providerCallId: string,
    config: TelephonyProviderConfigData,
  ): Promise<string>;

  abstract handleWebhook(
    payload: any,
    headers: any,
    query: any,
    config: TelephonyProviderConfigData,
  ): Promise<NormalizedCallEvent | null>;

  abstract validateWebhook(
    payload: any,
    headers: any,
    query: any,
    config: TelephonyProviderConfigData,
  ): boolean;

  abstract testConnection(
    config: TelephonyProviderConfigData,
  ): Promise<{ success: boolean; message: string }>;
}
