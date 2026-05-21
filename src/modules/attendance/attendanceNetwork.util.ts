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
  const clientSsid = normalize(payload.networkName);
  const clientRouter = (payload.routerIp || '').trim();
  const clientSubnet = (payload.subnet || '').trim();

  if (!clientIp && !clientSsid && !clientRouter) {
    return {
      ok: false,
      errorCode: 'OFFICE_NETWORK_METADATA_REQUIRED',
      message: 'Office check-in requires WiFi SSID, router IP, and device IP.',
      details: { hasIp: false, hasSsid: false, hasRouter: false },
    };
  }

  for (const network of enabledNetworks) {
    const expectedSsid = normalize(network.wifiSsid);
    const expectedRouter = network.routerIp.trim();
    const expectedSubnet = (network.subnet || '').trim();

    const ssidOk = !clientSsid || !expectedSsid || clientSsid === expectedSsid;
    const routerOk = !clientRouter || !expectedRouter || clientRouter === expectedRouter;
    const subnetOk = !clientSubnet || !expectedSubnet || clientSubnet === expectedSubnet;
    const ipOk = matchIpRange(clientIp, network.allowedIpRanges);

    if (ssidOk && routerOk && subnetOk && ipOk) {
      return { ok: true, networkId: network.id };
    }
  }

  const reference = enabledNetworks[0];
  return {
    ok: false,
    errorCode: 'OFFICE_NETWORK_VALIDATION_FAILED',
    message:
      'You can only mark attendance using an approved office network. Verify WiFi SSID, router IP, subnet, and device IP match your office settings.',
    details: {
      providedSsid: payload.networkName || '',
      providedRouterIp: payload.routerIp || '',
      providedIp: clientIp,
      providedSubnet: payload.subnet || '',
      expectedSsid: reference.wifiSsid,
      expectedRouterIp: reference.routerIp,
      expectedSubnet: reference.subnet || '',
      expectedIpRange: reference.allowedIpRanges || 'any',
    },
  };
};
