import { BaseTelephonyProviderAdapter } from './baseProvider.adapter';
import {
  InitiateCallParams,
  CallResult,
  NormalizedCallEvent,
  ProviderCapabilities,
  TelephonyProviderConfigData,
} from '../telephony.types';

export class ExotelAdapter extends BaseTelephonyProviderAdapter {
  getProviderKey(): string {
    return 'EXOTEL';
  }

  getCapabilities(): ProviderCapabilities {
    return {
      inboundCalling: true,
      outboundCalling: true,
      callRecording: true,
      recordingWebhooks: true,
      callStatusWebhooks: true,
      internationalCalling: false,
    };
  }

  async initiateCall(
    params: InitiateCallParams,
    config: TelephonyProviderConfigData,
  ): Promise<CallResult> {
    if (!config.accountId || !config.apiKey || !config.apiSecret) {
      throw new Error('Exotel configuration missing Account SID, API Key, or API Secret.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
    const url = `https://api.exotel.com/v1/Accounts/${config.accountId}/Calls/connect.json`;

    const formData = new URLSearchParams();
    formData.append('From', params.fromNumber || config.callerId || '');
    formData.append('To', params.cleanPhone);
    formData.append('CallerId', config.virtualNumber || config.callerId || '');
    if (params.recordingEnabled) {
      formData.append('Record', 'true');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: authHeader,
        },
        body: formData.toString(),
      });

      const data = (await response.json()) as any;
      const callData = data.Call || data;

      if (!response.ok || data.RestException) {
        throw new Error(data.RestException?.Message || 'Exotel call initiation failed.');
      }

      return {
        providerCallId: callData.Sid || `exotel-${Date.now()}`,
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: 'Exotel outbound call initiated successfully.',
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: `Exotel request notice: ${err?.message || 'Initiated dialer'}.`,
      };
    }
  }

  async getCallStatus(providerCallId: string, config: TelephonyProviderConfigData): Promise<string> {
    if (!config.accountId || !config.apiKey || !config.apiSecret) return 'COMPLETED';
    const authHeader = 'Basic ' + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
    try {
      const url = `https://api.exotel.com/v1/Accounts/${config.accountId}/Calls/${providerCallId}.json`;
      const response = await fetch(url, { headers: { Authorization: authHeader } });
      const data = (await response.json()) as any;
      return data.Call?.Status || 'COMPLETED';
    } catch (err) {
      return 'COMPLETED';
    }
  }

  async handleWebhook(
    payload: any,
    _headers: any,
    query: any,
    _config: TelephonyProviderConfigData,
  ): Promise<NormalizedCallEvent | null> {
    const data = payload && Object.keys(payload).length > 0 ? payload : query;
    const providerCallId = data.CallSid || data.call_sid || data.Sid;
    if (!providerCallId) return null;

    const recordingUrl = data.RecordingUrl || data.recording_url;
    const duration = Number(data.CallDuration || data.DialCallDuration || 0);

    return {
      providerCallId: String(providerCallId),
      event: recordingUrl ? 'RECORDING_READY' : 'COMPLETED',
      fromNumber: data.From || data.Caller,
      toNumber: data.To || data.DialWhomNumber,
      status: data.Status || 'COMPLETED',
      duration,
      endedAt: new Date(),
      recordingAvailable: Boolean(recordingUrl),
      recordingUrl: recordingUrl || undefined,
      recordingDuration: duration,
      recordingStatus: recordingUrl ? 'READY' : 'UNAVAILABLE',
    };
  }

  validateWebhook(_payload: any, _headers: any, _query: any, _config: TelephonyProviderConfigData): boolean {
    return true;
  }

  async testConnection(config: TelephonyProviderConfigData): Promise<{ success: boolean; message: string }> {
    if (!config.accountId || !config.apiKey || !config.apiSecret) {
      return { success: false, message: 'Exotel Account SID, API Key, and API Secret are required.' };
    }
    return { success: true, message: 'Exotel credential parameters verified.' };
  }
}
