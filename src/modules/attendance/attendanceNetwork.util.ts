export type OfficeNetworkRecord = {
  id: string;
  wifiSsid: string;
  routerIp: string;
  subnet?: string | null;
  allowedIpRanges?: string | null;
  isEnabled?: boolean;
};

export type NetworkCheckPayload = {
  ipAddress?: string | null;
  networkName?: string | null;
  routerIp?: string | null;
  subnet?: string | null;
};

export type OfficeNetworkValidationResult =
  | { ok: true; networkId: string }
  | { ok: false; errorCode: string; message: string; details: Record<string, string | boolean> };

const normalize = (value?: string | null): string => (value || '').trim().toLowerCase();

export const matchIpRange = (userIp: string | null | undefined, allowedRange: string | null | undefined): boolean => {
  if (!allowedRange?.trim()) return true;
  if (!userIp?.trim()) return false;

  const ranges = allowedRange
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return ranges.some((range) => {
    const regexStr = `^${range.replace(/\./g, '\\.').replace(/x|\*/gi, '.*')}$`;
    return new RegExp(regexStr).test(userIp.trim());
  });
};

/** Office WiFi rules apply only when user must physically check in from the office network. */
export const requiresOfficeNetworkValidation = (
  attendanceApplyType: string | null | undefined,
  attendanceType: string,
): boolean => {
  if (attendanceApplyType !== 'FROM_OFFICE') return false;
  if (attendanceType === 'HOLIDAY') return false;
  if (['WORK_FROM_HOME', 'LEAVE'].includes(attendanceType)) return false;
  return true;
};

const networkMatchesPayload = (network: OfficeNetworkRecord, payload: NetworkCheckPayload): boolean => {
  const clientIp = (payload.ipAddress || '').trim();
  const clientSsid = normalize(payload.networkName);
  const clientRouter = (payload.routerIp || '').trim();
  const clientSubnet = (payload.subnet || '').trim();

  const expectedSsid = normalize(network.wifiSsid);
  const expectedRouter = network.routerIp.trim();
  const expectedSubnet = (network.subnet || '').trim();

  if (!clientSsid || !expectedSsid || clientSsid !== expectedSsid) return false;
  if (!clientRouter || !expectedRouter || clientRouter !== expectedRouter) return false;

  const subnetOk = !expectedSubnet || !clientSubnet || clientSubnet === expectedSubnet;
  if (!subnetOk) return false;

  return matchIpRange(clientIp, network.allowedIpRanges);
};

export const validateOfficeNetwork = (
  networks: OfficeNetworkRecord[],
  payload: NetworkCheckPayload,
): OfficeNetworkValidationResult => {
  const enabledNetworks = networks.filter((network) => network.isEnabled !== false);

  if (enabledNetworks.length === 0) {
    return {
      ok: false,
      errorCode: 'OFFICE_NETWORK_NOT_CONFIGURED',
      message: 'No approved office network is configured. Contact your administrator.',
      details: { configuredNetworks: false },
    };
  }

  const clientIp = (payload.ipAddress || '').trim();
  const clientSsid = (payload.networkName || '').trim();
  const clientRouter = (payload.routerIp || '').trim();

  if (!clientSsid || !clientRouter || !clientIp) {
    return {
      ok: false,
      errorCode: 'OFFICE_NETWORK_METADATA_REQUIRED',
      message: 'Office check-in requires WiFi SSID, router IP, and device IP.',
      details: {
        hasIp: Boolean(clientIp),
        hasSsid: Boolean(clientSsid),
        hasRouter: Boolean(clientRouter),
      },
    };
  }

  const matched = enabledNetworks.find((network) => networkMatchesPayload(network, payload));
  if (matched) {
    return { ok: true, networkId: matched.id };
  }

  const reference = enabledNetworks[0];
  return {
    ok: false,
    errorCode: 'OFFICE_NETWORK_VALIDATION_FAILED',
    message:
      'Office network validation failed. Use the exact WiFi SSID, router IP, and device IP range configured for your workspace.',
    details: {
      providedSsid: clientSsid,
      providedRouterIp: clientRouter,
      providedIp: clientIp,
      providedSubnet: payload.subnet || '',
      expectedSsid: reference.wifiSsid,
      expectedRouterIp: reference.routerIp,
      expectedSubnet: reference.subnet || '',
      expectedIpRange: reference.allowedIpRanges || 'any',
      configuredNetworkCount: String(enabledNetworks.length),
    },
  };
};

export const toOfficeNetworkProfile = (network: OfficeNetworkRecord) => ({
  id: network.id,
  wifiSsid: network.wifiSsid,
  routerIp: network.routerIp,
  subnet: network.subnet || '255.255.255.0',
  allowedIpRanges: network.allowedIpRanges || '',
  sampleDeviceIp: deriveSampleDeviceIp(network.allowedIpRanges),
});

const deriveSampleDeviceIp = (allowedRange?: string | null): string => {
  const range = (allowedRange || '').trim();
  if (!range) return '192.168.1.100';
  const first = range.split(',')[0]?.trim() || range;
  if (first.includes('*') || first.includes('x')) {
    return first.replace(/\*/gi, '100').replace(/x/gi, '100');
  }
  return first;
};
