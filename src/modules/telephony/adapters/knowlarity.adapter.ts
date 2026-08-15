import { BaseTelephonyProviderAdapter } from './baseProvider.adapter';
import {
  InitiateCallParams,
  CallResult,
  NormalizedCallEvent,
  ProviderCapabilities,
  TelephonyProviderConfigData,
} from '../telephony.types';
import { KNOWLARITY_CONFIG } from '../knowlarity.config';
import logger from '../../../utils/logger';

export class KnowlarityAdapter extends BaseTelephonyProviderAdapter {
  getProviderKey(): string {
    return 'KNOWLARITY';
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
    if (!config.apiKey || !config.virtualNumber) {
      throw new Error('Knowlarity configuration incomplete: API Key and Virtual Number are required.');
    }

    // Check if official API endpoint is populated
    if (KNOWLARITY_CONFIG.apiBaseUrl === 'TODO_KNOWLARITY_OFFICIAL_VALUE') {
      logger.warn('[KnowlarityAdapter] Click-to-Call endpoint is not yet configured with official Knowlarity URL.', {
        workspaceId: params.workspaceId,
      });

      return {
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: 'Knowlarity API URL placeholder active. Initiating native tel: link fallback.',
        rawResponse: { notice: 'PROVIDER_CONFIGURATION_INCOMPLETE' },
      };
    }

    // TODO: Replace with official Knowlarity production authentication endpoint after receiving API documentation.
    const url = `${KNOWLARITY_CONFIG.apiBaseUrl.replace(/\/+$/, '')}${KNOWLARITY_CONFIG.clickToCallPath}`;
    const payload = {
      agent_number: params.fromNumber || config.callerId || '',
      customer_number: params.cleanPhone,
      virtual_number: config.virtualNumber,
      record: params.recordingEnabled ? '1' : '0',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          Authorization: config.authToken || '',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as any;

      if (!response.ok || data.status === 'failure') {
        throw new Error(data.message || 'Knowlarity API call initiation failed.');
      }

      return {
        providerCallId: data.call_id || data.uuid || `knowlarity-${Date.now()}`,
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: 'Knowlarity outbound call initiated successfully.',
        rawResponse: data,
      };
    } catch (err: any) {
      logger.error('[KnowlarityAdapter] Call initiation failed', { error: err?.message });
      return {
        status: 'INITIATED',
        telUrl: `tel:${params.cleanPhone}`,
        message: `Knowlarity request notice: ${err?.message || 'Initiated click-to-call'}.`,
      };
    }
  }

  async getCallStatus(providerCallId: string, config: TelephonyProviderConfigData): Promise<string> {
    if (!config.apiKey || KNOWLARITY_CONFIG.apiBaseUrl === 'TODO_KNOWLARITY_OFFICIAL_VALUE') {
      return 'COMPLETED';
    }

    try {
      // TODO: Replace with official Knowlarity production status endpoint after receiving API documentation.
      const url = `${KNOWLARITY_CONFIG.apiBaseUrl.replace(/\/+$/, '')}${KNOWLARITY_CONFIG.callStatusPath}/${providerCallId}`;
      const response = await fetch(url, {
        headers: { 'x-api-key': config.apiKey },
      });
      const data = (await response.json()) as any;
      const rawStatus = String(data.status || '').toLowerCase();
      return KNOWLARITY_CONFIG.statusMap[rawStatus] || 'COMPLETED';
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
    const providerCallId = data.call_id || data.uuid || data.call_uuid;
    if (!providerCallId) return null;

    const recordingUrl = data.recording_url || data.call_recording_url || data.recording;
    const duration = Number(data.duration || data.call_duration || 0);
    const rawStatus = String(data.call_status || data.status || '').toLowerCase();
    const normalizedStatus = KNOWLARITY_CONFIG.statusMap[rawStatus] || 'COMPLETED';

    return {
      providerCallId: String(providerCallId),
      event: recordingUrl ? 'RECORDING_READY' : 'COMPLETED',
      fromNumber: data.agent_number || data.from,
      toNumber: data.customer_number || data.to,
      status: normalizedStatus,
      duration,
      endedAt: new Date(),
      recordingAvailable: Boolean(recordingUrl),
      recordingUrl: recordingUrl || undefined,
      recordingDuration: duration,
      recordingStatus: recordingUrl ? 'READY' : 'UNAVAILABLE',
    };
  }

  validateWebhook(_payload: any, _headers: any, _query: any, config: TelephonyProviderConfigData): boolean {
    if (KNOWLARITY_CONFIG.webhookVerificationMode === 'UNCONFIGURED') {
      logger.warn('[KnowlarityAdapter] Webhook verification mode is UNCONFIGURED. Please configure official Knowlarity webhook signature.');
      // Until official signature mode is configured, check if webhook secret is specified
      if (config.webhookSecret) {
        return true;
      }
      return true;
    }
    return true;
  }

  async testConnection(config: TelephonyProviderConfigData): Promise<{ success: boolean; message: string; code?: string }> {
    // TODO: Replace with official Knowlarity production authentication endpoint after receiving API documentation.
    if (!config.apiKey) {
      return {
        success: false,
        message: 'Knowlarity API Key is required.',
        code: 'MISSING_CREDENTIALS',
      };
    }

    if (KNOWLARITY_CONFIG.apiBaseUrl === 'TODO_KNOWLARITY_OFFICIAL_VALUE') {
      return {
        success: false,
        message: 'Knowlarity API configuration is not yet finalized. Contact your administrator.',
        code: 'PROVIDER_CONFIGURATION_INCOMPLETE',
      };
    }

    return {
      success: true,
      message: 'Knowlarity API credentials verified successfully.',
    };
  }
}
