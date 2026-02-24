// routes/signup.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const crypto = require('crypto');
const { withProdTokenRetry } = require('../services/getToken');

const rawBase = (process.env.API_BASE_URL || process.env.CRM_BASE_URL || '').trim();
const apiBaseUrl = rawBase ? rawBase.replace(/\/+$/, '') + '/' : '';

const httpsAgent =
  String(process.env.ALLOW_INSECURE_SSL || 'false') === 'true'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

// ---- helpers ----
function safeStr(v) {
  return String(v ?? '').trim();
}

function normalizeEmail(v) {
  return safeStr(v).toLowerCase();
}

/**
 * Normalize phone RAW (do NOT encode here).
 * - removes whitespace
 * - decodes once if input is already %2B...
 * - returns raw E.164 (+639...) so qs.stringify can encode it ONCE
 */
function normalizePhoneRaw(input) {
  let v = safeStr(input).replace(/\s+/g, '');
  if (!v) return '';

  // If client already sent %2B..., normalize back to +...
  try {
    if (/%2B/i.test(v) || /%[0-9A-Fa-f]{2}/.test(v)) v = decodeURIComponent(v);
  } catch {
    // ignore
  }

  return v;
}

function dialCodeFromPhone(raw) {
  const v = safeStr(raw).replace(/\s+/g, '');
  if (v.startsWith('+63')) return '+63';
  if (v.startsWith('+1')) return '+1';
  if (v.startsWith('+44')) return '+44';
  if (v.startsWith('+61')) return '+61';
  return '';
}

/**
 * Best-effort mapping to prevent CRM "flag 59" mismatches.
 * Priority:
 *  1) If req.body.country is provided -> use it
 *  2) Else map from phone dial code
 * Fallback -> Canada
 */
function resolveCountryAndNationality(bodyCountry, phoneRaw) {
  const c = safeStr(bodyCountry);

  if (c) {
    const country = c;
    const nationality =
      /philippines/i.test(country) ? 'Filipino' :
      /canada/i.test(country) ? 'Canadian' :
      /united states/i.test(country) ? 'American' :
      /united kingdom/i.test(country) ? 'British' :
      /australia/i.test(country) ? 'Australian' :
      'Canadian';

    return { country, nationality };
  }

  const dc = dialCodeFromPhone(phoneRaw);
  if (dc === '+63') return { country: 'Philippines', nationality: 'Filipino' };
  if (dc === '+1')  return { country: 'Canada', nationality: 'Canadian' }; // could be US
  if (dc === '+44') return { country: 'United Kingdom', nationality: 'British' };
  if (dc === '+61') return { country: 'Australia', nationality: 'Australian' };

  return { country: 'Canada', nationality: 'Canadian' };
}

function normalizePostalCode(country, postal) {
  const p = safeStr(postal);
  if (!p) {
    if (/philippines/i.test(country)) return '8000';
    return '0000';
  }
  return p;
}

function mapFlagToMessage(flag) {
  const f = String(flag ?? '');
  const map = {
    '7': 'This account already exists. Please log in, reset your password, or contact support for help.',
    '59': 'Signup rejected by CRM. Please verify phone/country match and required profile fields.',
  };
  return map[f] || '';
}


router.post('/', async (req, res) => {
  const body = req.body || {};

  const firstname = safeStr(body.firstname);
  const lastname  = safeStr(body.lastname);
  const email     = normalizeEmail(body.email);
  const password  = safeStr(body.password);

  // Normalize RAW phone 
  const mobilenumberRaw = normalizePhoneRaw(body.mobilenumber);

 
  const bodyCountry = safeStr(body.country);
  const bodyPostal  = safeStr(body.postalcode);

  if (!firstname || !lastname || !email || !mobilenumberRaw || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  if (!apiBaseUrl) {
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: missing API_BASE_URL / CRM_BASE_URL',
    });
  }

  try {
    const hashedPwd = crypto.createHash('sha256').update(password, 'utf8').digest('hex');

    const { country, nationality } = resolveCountryAndNationality(bodyCountry, mobilenumberRaw);
    const postalcode = normalizePostalCode(country, bodyPostal);

    const resp = await withProdTokenRetry(async (token) => {
      const payload = {
        salutation: 'Mr',
        Firstname: firstname,
        Lastname: lastname,
        Emailaddress: email,

        dateofbirth: safeStr(body.dateofbirth) || '08/08/1988',

        Nationality: safeStr(body.nationality) || nationality,
        Membershippwd: hashedPwd,

        Mailingaddress: safeStr(body.mailingaddress) || 'N/A',
        Postalcode: postalcode,
        City: safeStr(body.city) || 'N/A',
        State: safeStr(body.state) || 'N/A',
        Country: country,

        Phonenumber: mobilenumberRaw,
        Mobilenumber: mobilenumberRaw,

        Contactpreference: safeStr(body.contactpreference) || 'email',
        Communicationpreference: safeStr(body.communicationspreference) || '111111',
        Promotioncode: safeStr(body.promotioncode) || '',

        flag: safeStr(body.flag) || '0',
        socialMediaType: safeStr(body.socialMediaType) || '1',

        token,
      };

      const form = qs.stringify(payload, { encodeValuesOnly: true });

      return axios.post(`${apiBaseUrl}RegisterMembership`, form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent,
        timeout: 30000,
      });
    });

    const data = resp.data || {};
    const flag = data?.flag;

    console.log('[RegisterMembership] flag:', flag);

    if (String(flag) === '0') {
      return res.status(201).json({
        success: true,
        message: 'success',
        flag: String(flag),
      });
    }

    if (String(flag) === '7') {
      return res.status(409).json({
        success: false,
        code: 'This Account Already Exists, please try to login or reset your password',
        message: 'This account already exists. Please log in, reset your password, or contact support for help.',
        flag: String(flag),
      });
    }

    const crmMsg =
      safeStr(data?.message) ||
      safeStr(data?.result) ||
      safeStr(data?.error) ||
      mapFlagToMessage(flag) ||
      'Signup failed';

    return res.status(400).json({
      success: false,
      message: crmMsg,
      flag: String(flag ?? ''),
     
    });
  } catch (err) {
    if (err?.response) {
      const r = err.response.data || {};
      const status = err.response.status || 502;

      const msg =
        safeStr(r?.message) ||
        safeStr(r?.result) ||
        safeStr(r?.error) ||
        'CRM error, Please Support.';

      return res.status(status).json({
        success: false,
        message: msg,
        flag: r?.flag ? String(r.flag) : undefined,
      });
    }

    return res.status(500).json({ success: false, message: 'Server Error, Please Support.' });
  }
});

module.exports = router;
