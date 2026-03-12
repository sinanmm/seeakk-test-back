"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkspaceConfigMeta = void 0;
// @ts-expect-error - geoip-lite does not have proper types in the registry
const geoip_lite_1 = __importDefault(require("geoip-lite"));
const currency_codes_1 = __importDefault(require("currency-codes"));
const iso_639_1_1 = __importDefault(require("iso-639-1"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const countryToCurrency = {
    US: 'USD', GB: 'GBP', IN: 'INR', AU: 'AUD', CA: 'CAD', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
    JP: 'JPY', CN: 'CNY', BR: 'BRL', RU: 'RUB', KR: 'KRW', ZA: 'ZAR', MX: 'MXN', SG: 'SGD', HK: 'HKD',
    NZ: 'NZD', SE: 'SEK', CH: 'CHF', NO: 'NOK', DK: 'DKK', PL: 'PLN', TH: 'THB', ID: 'IDR', MY: 'MYR',
    PH: 'PHP', VN: 'VND', TR: 'TRY', AE: 'AED', SA: 'SAR', EG: 'EGP', NG: 'NGN', AR: 'ARS', CO: 'COP',
};
const getWorkspaceConfigMeta = async (req, res, next) => {
    try {
        const timeZones = moment_timezone_1.default.tz.names();
        const languages = iso_639_1_1.default.getAllCodes().map((code) => ({
            code,
            label: `${iso_639_1_1.default.getNativeName(code)} (${iso_639_1_1.default.getName(code)})`,
        }));
        const currencies = currency_codes_1.default.data
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
            if (iso_639_1_1.default.validate(primaryLang)) {
                defaultLanguage = primaryLang;
            }
        }
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
            ip = '207.97.227.239';
        }
        const geo = geoip_lite_1.default.lookup(ip);
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
    }
    catch (error) {
        next(error);
    }
};
exports.getWorkspaceConfigMeta = getWorkspaceConfigMeta;
