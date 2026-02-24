// routes/testsignup.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const crypto = require('crypto');
const { withProdTokenRetry } = require('../services/getToken');

const apiBaseUrl =
  (process.env.API_BASE_URL || process.env.CRM_BASE_URL || '').replace(/\/+$/, '') + '/';

console.log('CRM base:', apiBaseUrl); // temporary: verify it's correctapiBaseUrl = process.env.CRM_BASE_URL?.replace(/\/+$/, '') + '/';

const httpsAgent =
  String(process.env.ALLOW_INSECURE_SSL || 'false') === 'true'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

const APP_SECRET = process.env.APP_SECRET || '';

/**
 * HelpersW
 */
function deriveKeyBytes(sourceString, bytes = 32) {
  const full = crypto.createHash('sha256').update(String(sourceString || ''), 'utf8').digest();
  return full.slice(0, bytes);
}
function aesEcbEncryptBase64(plaintext, keyBytes) {
  const algo = keyBytes.length === 16 ? 'aes-128-ecb' : 'aes-256-ecb';
  const cipher = crypto.createCipheriv(algo, keyBytes, null);
  cipher.setAutoPadding(true);
  let enc = cipher.update(String(plaintext), 'utf8', 'base64');
  enc += cipher.final('base64');
  return enc;
}
function encryptPassword({ plaintext, mode, keySource, token }) {
  switch (mode) {
    case 'aes128-ecb-b64': {
      const key = keySource === 'secret' ? APP_SECRET : token;
      const keyBytes = deriveKeyBytes(key, 16);
      return aesEcbEncryptBase64(plaintext, keyBytes);
    }
    case 'aes256-ecb-b64': {
      const key = keySource === 'secret' ? APP_SECRET : token;
      const keyBytes = deriveKeyBytes(key, 32);
      return aesEcbEncryptBase64(plaintext, keyBytes);
    }
    case 'sha256-hex':
      return crypto.createHash('sha256').update(String(plaintext), 'utf8').digest('hex');
    case 'md5-hex':
      return crypto.createHash('md5').update(String(plaintext), 'utf8').digest('hex');
    default:
      throw new Error(`Unsupported enc mode: ${mode}`);
  }
}

/**
 * /api/testsignup
 * Usage examples:
 *  POST /api/testsignup?enc=aes256-ecb-b64&key=token
 *  POST /api/testsignup?enc=sha256-hex
 */
router.post('/', async (req, res) => {
  const encMode = (req.query.enc || 'aes256-ecb-b64').toString();
  const keySource = (req.query.key || 'token').toString(); // token | secret
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Raw body received:', req.body);

  const { firstname, lastname, email, mobilenumber, password } = req.body || {};
  if (!firstname || !lastname || !email || !mobilenumber || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const token = await withProdTokenRetry(async (svcToken) => ({ data: { flag: '0', token: svcToken }, token: svcToken }));
    const resolvedToken = token?.token || token?.data?.token;
    if (!resolvedToken) return res.status(502).json({ success: false, message: 'Upstream token unavailable' });

    const encryptedPwd = encryptPassword({ plaintext: password, mode: encMode, keySource, token: resolvedToken });

    console.log(' Testing signup encryption:', { encMode, keySource, outLen: encryptedPwd.length });

    const payload = {
      salutation: 'Mr',
      Firstname: firstname,
      Lastname: lastname,
      Emailaddress: email,
      dateofbirth: '08/08/1988',
      Nationality: 'Canadian',
      Membershippwd: encryptedPwd,
      Mailingaddress: 'N/A',
      Postalcode: '0000',
      City: 'N/A',
      State: 'N/A',
      Country: 'Canada',
      Phonenumber: mobilenumber,
      Mobilenumber: mobilenumber,
      Contactpreference: 'email',
      Communicationpreference: '111111',
      Promotioncode: '',
      flag: '0',
      socialMediaType: '1',
      token: resolvedToken
    };

    const form = qs.stringify(payload);
    const response = await axios.post(`${apiBaseUrl}RegisterMembership`, form, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  httpsAgent, // ⬅️ important
});

    const data = response.data;
    console.log(' CRM test response:', data);

    return res.status(200).json({
      success: data?.flag === '0',
      message: data?.message || data?.result || (data?.flag === '0' ? 'Signup successful' : 'Signup failed'),
      flag: data?.flag,
      encMode,
      keySource,
      result: data
    });
  } catch (err) {
    if (err.response) {
      console.error('🔥 CRM error:', err.response.status, err.response.data);
      return res.status(err.response.status).json({
        success: false,
        message: err.response.data?.message || 'CRM error',
        result: err.response.data
      });
    }
    console.error('🔥 Test signup error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;
