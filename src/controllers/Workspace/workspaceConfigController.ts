import { Request, Response, NextFunction } from 'express';
import currencyCodes from 'currency-codes';
import ISO6391 from 'iso-639-1';
import moment from 'moment-timezone';
import logger from '../../utils/logger';

const countryToCurrency: Record<string, string> = {
  US: 'USD', GB: 'GBP', IN: 'INR', AU: 'AUD', CA: 'CAD', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  JP: 'JPY', CN: 'CNY', BR: 'BRL', RU: 'RUB', KR: 'KRW', ZA: 'ZAR', MX: 'MXN', SG: 'SGD', HK: 'HKD',
  NZ: 'NZD', SE: 'SEK', CH: 'CHF', NO: 'NOK', DK: 'DKK', PL: 'PLN', TH: 'THB', ID: 'IDR', MY: 'MYR',
  PH: 'PHP', VN: 'VND', TR: 'TRY', AE: 'AED', SA: 'SAR', EG: 'EGP', NG: 'NGN', AR: 'ARS', CO: 'COP',
};

const lookupGeoByIp = (ip: string): { timezone?: string; country?: string } | null => {
  try {
    // Lazily requiring geoip-lite avoids crashing app startup if geo DB files are missing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const geoip = require('geoip-lite');
    return geoip.lookup(ip);
  } catch (error) {
    logger.warn('GeoIP lookup disabled; continuing with defaults', {
      reason: (error as Error)?.message || 'Unknown error',
    });
    return null;
  }
};

export const getWorkspaceConfigMeta = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const timeZones = moment.tz.names();

    const languages = ISO6391.getAllCodes().map((code: string) => ({
      code,
      label: `${ISO6391.getNativeName(code)} (${ISO6391.getName(code)})`,
    }));

    const currencies = currencyCodes.data
      .map((c) => ({
        code: c.code,
        label: `${c.currency} (${c.code})`,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    let defaultTimeZone = 'UTC';
    let defaultLanguage = 'en';
    let defaultCurrencyLocale = 'USD';

    const acceptLanguage = req.headers['accept-language'];
    if (acceptLanguage) {
      const primaryLang = acceptLanguage.split(',')[0].split('-')[0].toLowerCase();
      if (ISO6391.validate(primaryLang)) {
        defaultLanguage = primaryLang;
      }
    }

    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
      ip = '207.97.227.239';
    }

    const geo = lookupGeoByIp(ip as string);
    if (geo) {
      if (geo.timezone) {
        defaultTimeZone = geo.timezone;
      }
      if (geo.country) {
        if (countryToCurrency[geo.country]) {
          defaultCurrencyLocale = countryToCurrency[geo.country];
        }
      }
    }

    return res.status(200).json({
      lists: {
        timeZones,
        languages,
        currencies,
      },
      defaults: {
        timeZone: defaultTimeZone,
        language: defaultLanguage,
        currencyLocale: defaultCurrencyLocale,
      },
    });
  } catch (error) {
    next(error);
  }
};
