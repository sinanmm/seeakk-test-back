import { Request, Response, NextFunction } from 'express';
// @ts-expect-error - geoip-lite does not have proper types in the registry
import geoip from 'geoip-lite';
import currencyCodes from 'currency-codes';
import ISO6391 from 'iso-639-1';
import moment from 'moment-timezone';

const countryToCurrency: Record<string, string> = {
  US: 'USD', GB: 'GBP', IN: 'INR', AU: 'AUD', CA: 'CAD', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  JP: 'JPY', CN: 'CNY', BR: 'BRL', RU: 'RUB', KR: 'KRW', ZA: 'ZAR', MX: 'MXN', SG: 'SGD', HK: 'HKD',
  NZ: 'NZD', SE: 'SEK', CH: 'CHF', NO: 'NOK', DK: 'DKK', PL: 'PLN', TH: 'THB', ID: 'IDR', MY: 'MYR',
  PH: 'PHP', VN: 'VND', TR: 'TRY', AE: 'AED', SA: 'SAR', EG: 'EGP', NG: 'NGN', AR: 'ARS', CO: 'COP',
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

    const geo = geoip.lookup(ip as string);
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
