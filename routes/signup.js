// routes/signup.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const crypto = require('crypto');
const { getToken } = require('../services/getToken');

const apiBaseUrl = (process.env.API_BASE_URL || process.env.CRM_BASE_URL || '').replace(/\/+$/, '') + '/';
const httpsAgent = String(process.env.ALLOW_INSECURE_SSL || 'false') === 'true'
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

router.post('/', async (req, res) => {
  // sanitize
  const { firstname, lastname, email, mobilenumber, password } = req.body || {};
  const fn = String(firstname || '').trim();
  const ln = String(lastname || '').trim();
  const em = String(email || '').trim().toLowerCase();
  const mn = String(mobilenumber || '').replace(/\s+/g, '').trim();
  const pw = String(password || '').trim();

  if (!fn || !ln || !em || !mn || !pw) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // token (still required by Meta)
    const token = await getToken();
    if (!token) return res.status(502).json({ success: false, message: 'Upstream token unavailable' });

    // hash password -> SHA-256 hex (Meta accepts)
    const hashedPwd = crypto.createHash('sha256').update(pw, 'utf8').digest('hex');

    // payload for RegisterMembership
    const payload = {
      salutation: 'Mr',
      Firstname: fn,
      Lastname: ln,
      Emailaddress: em,
      dateofbirth: '08/08/1988',          // TODO: wire real DOB when UI has it
      Nationality: 'Canadian',
      Membershippwd: hashedPwd,           // <-- SHA-256 hex
      Mailingaddress: 'N/A',
      Postalcode: '0000',
      City: 'N/A',
      State: 'N/A',
      Country: 'Canada',
      Phonenumber: mn,
      Mobilenumber: mn,
      Contactpreference: 'email',
      Communicationpreference: '111111',
      Promotioncode: '',
      flag: '0',
      socialMediaType: '1',
      token                                 // Meta expects token in body for this API (keep)
    };

    const form = qs.stringify(payload);
    const resp = await axios.post(`${apiBaseUrl}RegisterMembership`, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent
    });

    const data = resp.data;

    if (data?.flag === '0') {
      return res.status(201).json({
        success: true,
        message: 'success',
        flag: data.flag,
        result: data
      });
    }

    // duplicate or other errors
    if (/exist|duplicate/i.test(String(data?.message || data?.result || ''))) {
      return res.status(409).json({ success: false, message: 'Account already exists', result: data });
    }

    return res.status(400).json({ success: false, message: data?.message || data?.result || 'Signup failed', result: data });

  } catch (err) {
    if (err.response) {
      return res.status(err.response.status || 502).json({
        success: false,
        message: err.response.data?.message || 'CRM error',
        result: err.response.data
      });
    }
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;
