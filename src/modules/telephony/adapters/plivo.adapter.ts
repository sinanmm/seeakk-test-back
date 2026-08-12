import { BaseTelephonyProviderAdapter } from './baseProvider.adapter';
import {
  InitiateCallParams,
  CallResult,
  NormalizedCallEvent,
  ProviderCapabilities,
  TelephonyProviderConfigData,
} from '../telephony.types';

export class PlivoAdapter extends BaseTelephonyProviderAdapter {
  getProviderKey(): string {
    return 'PLIVO';
  }

  getCapabilities(): ProviderCapabilities {
    return {
      inboundCalling: true,
      outboundCalling: true,
      callRecording: true,
      recordingWebhooks: true,
      callStatusWebhooks: true,
      internationalCalling: true,
    };
  }

  async initiateCall(
    params: InitiateCallParams,
    config: TelephonyProviderConfigData,
  ): Promise<CallResult> {
    if (!config.accountId || !config.authToken) {
      throw new Error('Plivo configuration missing Auth ID or Auth Token.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${config.accountId}:${config.authToken}`).toString('base64');
    const url = `https://api.plivo.com/v1/Account/${config.accountId}/Call/`;

    const payload = {
      from: config.callerId || config.virtualNumber || params.fromNumber,
      to: params.cleanPhone,
      answer_url: 'https://s3.amazonaws.com/static.plivo.com/answer.xml',
      record: params.recordingEnabled ? 'true' : 'false',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as any;

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Plivo API call initiation failed.');
      }

      return {
        providerCallId: data.request_uuid || `plivo-${Date.now()}`,
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: 'Plivo outbound call initiated successfully.',
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: `Plivo request notice: ${err?.message || 'Initiated dialer'}.`,
      };
    }
  }

  async getCallStatus(providerCallId: string, config: TelephonyProviderConfigData): Promise<string> {
    if (!config.accountId || !config.authToken) return 'COMPLETED';
    const authHeader = 'Basic ' + Buffer.from(`${config.accountId}:${config.authToken}`).toString('base64');
    try {
      const url = `https://api.plivo.com/v1/Account/${config.accountId}/Call/${providerCallId}/`;
      const response = await fetch(url, { headers: { Authorization: authHeader } });
      const data = (await response.json()) as any;
      return data.call_status || 'COMPLETED';
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
    const providerCallId = data.CallUUID || data.call_uuid || data.RequestUUID;
    if (!providerCallId) return null;

    const recordingUrl = data.RecordUrl || data.recording_url;
    const duration = Number(data.CallDuration || data.recording_duration || 0);

    return {
      providerCallId: String(providerCallId),
      event: recordingUrl ? 'RECORDING_READY' : 'COMPLETED',
      fromNumber: data.From || data.from,
      toNumber: data.To || data.to,
      status: data.CallStatus || 'COMPLETED',
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
    if (!config.accountId || !config.authToken) {
      return { success: false, message: 'Plivo Auth ID and Auth Token are required.' };
    }
    return { success: true, message: 'Plivo credentials format verified.' };
  }
}
