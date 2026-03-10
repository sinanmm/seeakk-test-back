const geoip = require('geoip-lite');
const currencyCodes = require('currency-codes');
const ISO6391 = require('iso-639-1');
const moment = require('moment-timezone');

const countryToCurrency = {
    US: 'USD', GB: 'GBP', IN: 'INR', AU: 'AUD', CA: 'CAD', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
    JP: 'JPY', CN: 'CNY', BR: 'BRL', RU: 'RUB', KR: 'KRW', ZA: 'ZAR', MX: 'MXN', SG: 'SGD', HK: 'HKD',
    NZ: 'NZD', SE: 'SEK', CH: 'CHF', NO: 'NOK', DK: 'DKK', PL: 'PLN', TH: 'THB', ID: 'IDR', MY: 'MYR',
    PH: 'PHP', VN: 'VND', TR: 'TRY', AE: 'AED', SA: 'SAR', EG: 'EGP', NG: 'NGN', AR: 'ARS', CO: 'COP',
    // ... fallback to USD if missing below
};

exports.getWorkspaceConfigMeta = async (req, res, next) => {
    try {
        // 1. Generate Full ISO/IANA Dropdown Source Lists
        const timeZones = moment.tz.names(); // Array of IANA strings

        const languages = ISO6391.getAllCodes().map(code => ({
            code,
            label: `${ISO6391.getNativeName(code)} (${ISO6391.getName(code)})`
        })); // ISO-639 Standard Array

        const currencies = currencyCodes.data.map(c => ({
            code: c.code,
            label: `${c.currency} (${c.code})`
        })).sort((a, b) => a.code.localeCompare(b.code)); // ISO-4217 Standard Array

        // 2. Safely Detect Browser Settings via IP and Headers
        let defaultTimeZone = "UTC";
        let defaultLanguage = "en";
        let defaultCurrencyLocale = "USD";

        // Language Auto-Detection from Header
        const acceptLanguage = req.headers['accept-language'];
        if (acceptLanguage) {
            const primaryLang = acceptLanguage.split(',')[0].split('-')[0].toLowerCase();
            if (ISO6391.validate(primaryLang)) {
                defaultLanguage = primaryLang;
            }
        }

        // IP-based Geo location for Country -> Timezone & Currency
        // Hard-coded typical remoteAddress for actual detection, safely ignoring localhost loopbacks
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

        if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
            // In local Dev, fallback gracefully to a generic US/Global state 
            ip = "207.97.227.239";
        }

        const geo = geoip.lookup(ip);
        if (geo) {
            if (geo.timezone) {
                // GeoIP gives accurate IANA Timezone directly (e.g. 'Asia/Kolkata')
                defaultTimeZone = geo.timezone;
            }
            if (geo.country) {
                // Convert Alpha-2 ISO to Currency (e.g. 'IN' -> 'INR')
                if (countryToCurrency[geo.country]) {
                    defaultCurrencyLocale = countryToCurrency[geo.country];
                }
            }
        }

        return res.status(200).json({
            lists: {
                timeZones,
                languages,
                currencies
            },
            defaults: {
                timeZone: defaultTimeZone,
                language: defaultLanguage,
                currencyLocale: defaultCurrencyLocale
            }
        });

    } catch (error) {
        next(error);
    }
};
