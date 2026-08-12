import { BaseTelephonyProviderAdapter } from './adapters/baseProvider.adapter';
import { DeviceDialerAdapter } from './adapters/deviceDialer.adapter';
import { KnowlarityAdapter } from './adapters/knowlarity.adapter';
import { PlivoAdapter } from './adapters/plivo.adapter';
import { ExotelAdapter } from './adapters/exotel.adapter';

const adapters = new Map<string, BaseTelephonyProviderAdapter>([
  ['DEVICE_DIALER', new DeviceDialerAdapter()],
  ['KNOWLARITY', new KnowlarityAdapter()],
  ['PLIVO', new PlivoAdapter()],
  ['EXOTEL', new ExotelAdapter()],
]);

export const getTelephonyAdapter = (providerKey: string): BaseTelephonyProviderAdapter => {
  const key = (providerKey || 'DEVICE_DIALER').toUpperCase();
  const adapter = adapters.get(key);
  if (!adapter) {
    // Fallback to built-in DeviceDialer if unsupported key passed
    return adapters.get('DEVICE_DIALER')!;
  }
  return adapter;
};

export const getAllAvailableProviders = () => {
  return Array.from(adapters.entries()).map(([key, adapter]) => ({
    key,
    name:
      key === 'DEVICE_DIALER'
        ? 'Device Dialer (Built-in)'
        : key === 'KNOWLARITY'
        ? 'Knowlarity Cloud Telephony'
        : key === 'PLIVO'
        ? 'Plivo Global Telephony'
        : 'Exotel Telephony',
    capabilities: adapter.getCapabilities(),
  }));
};
