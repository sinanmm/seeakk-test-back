import { BaseTelephonyProviderAdapter } from './baseProvider.adapter';
import {
  InitiateCallParams,
  CallResult,
  NormalizedCallEvent,
  ProviderCapabilities,
  TelephonyProviderConfigData,
} from '../telephony.types';

export class DeviceDialerAdapter extends BaseTelephonyProviderAdapter {
  getProviderKey(): string {
    return 'DEVICE_DIALER';
  }

  getCapabilities(): ProviderCapabilities {
    return {
      inboundCalling: false,
      outboundCalling: true,
      callRecording: false,
      recordingWebhooks: false,
      callStatusWebhooks: false,
      internationalCalling: true,
    };
  }

  async initiateCall(
    params: InitiateCallParams,
    _config: TelephonyProviderConfigData,
  ): Promise<CallResult> {
    const telUrl = `tel:${params.cleanPhone}`;
    return {
      status: 'INITIATED',
      telUrl,
      message: 'Direct device dialer call URL generated',
    };
  }

  async getCallStatus(_providerCallId: string): Promise<string> {
    return 'COMPLETED';
  }

  async handleWebhook(): Promise<NormalizedCallEvent | null> {
    return null;
  }

  validateWebhook(): boolean {
    return true;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: 'Device Dialer is built-in and ready for native browser/device dialing.',
    };
  }
}
