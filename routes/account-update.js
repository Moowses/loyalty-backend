// routes/account-update.js
const express = require('express');
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const crypto = require('crypto');
const { withProdTokenRetry } = require('../services/getToken');

const router = express.Router();


const API_BASE =
  (process.env.META_API_BASE && process.env.META_API_BASE.trim()) ||
  'https://servicehub.metasphere.global:8966/api/';

const agent = new https.Agent({ rejectUnauthorized: false });

const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');


const FLAG_MAP = {
  '0': 'success',
  '1': 'Validation failed',
  '3': 'Membership email does not exist',
  '4': 'System error',
  '5': 'Incorrect membership password',
  '7': 'Multiple profiles for this email',
};

//helper login (query params)
async function vendorLogin(email, pwdHex, svcToken) {
  const url = `${API_BASE}LoginthroughEmail?` + qs.stringify({
    email,
    membershippwd: pwdHex,
    flag: '0',
    token: svcToken,
  });

  // Your login uses POST with query params — match it 1:1
  const resp = await axios.post(url, {}, { httpsAgent: agent, timeout: 15000 });
  const data = resp?.data || {};
  const flag = String(data.flag ?? '');
  const ok = flag === '0' || String(data.result || '').toLowerCase() === 'success';
  return { ok, flag, data };
}


//Helperset new password (JSON)

async function vendorSetPassword(email, encryptedPwd, svcToken) {
  const url = `${API_BASE}ResetPasswordProfile`;
  const resp = await axios.post(
    url,
    { email, newPassword: encryptedPwd, token: svcToken },
    { httpsAgent: agent, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 }
  );

  const data = resp?.data || {};
  const flag = String(data.flag ?? '');
  const msg = String(data.msg || '');
  const ok = flag === '0' || msg.toLowerCase() === 'success';
  return { ok, flag, msg, data };
}

//check current password validity
router.post('/check-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || '').trim();

  if (!email || !currentPassword) {
    return res.status(400).json({ ok: false, message: 'Email and currentPassword are required.' });
  }

  try {
    const currentHex = sha256Hex(currentPassword); // same encryption as login
    const login = await withProdTokenRetry((svcToken) => vendorLogin(email, currentHex, svcToken));

    if (login.ok) {
      return res.json({ ok: true, message: 'Current password is valid.' });
    }

    const msg = FLAG_MAP[login.flag] || 'Login failed.';
    const code = login.flag === '5' ? 401 : login.flag === '3' ? 404 : 400;
    return res.status(code).json({ ok: false, flag: Number(login.flag) || undefined, message: msg });
  } catch (e) {
    if (e?.response) {
      return res.status(502).json({
        ok: false,
        message: 'Upstream login failed',
        status: e.response.status,
        data: typeof e.response.data === 'string' ? e.response.data.slice(0, 300) : e.response.data,
      });
    }
    return res.status(500).json({ ok: false, message: 'Server error while checking password.' });
  }
});

//change password after validating current password
router.post('/change-password', async (req, res) => {
  const email           = String(req.body?.email || '').trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || '').trim();
  const newPassword     = String(req.body?.newPassword || '').trim();

  if (!email || !currentPassword || !newPassword) {
    return res.status(400).json({ ok: false, message: 'Email, currentPassword and newPassword are required.' });
  }

  try {
    // 1) Verify current password (same as login)
    const currentHex = sha256Hex(currentPassword);
    const verify = await withProdTokenRetry((svcToken) => vendorLogin(email, currentHex, svcToken));
    if (!verify.ok) {
      const msg = FLAG_MAP[verify.flag] || 'Current password invalid.';
      const code = verify.flag === '5' ? 401 : verify.flag === '3' ? 404 : 400;
      return res.status(code).json({ ok: false, stage: 'verify', flag: Number(verify.flag) || undefined, message: msg });
    }

    // Set new password (SHA-256 first)
    const newEncrypted = sha256Hex(newPassword);
    let result = await withProdTokenRetry((svcToken) => vendorSetPassword(email, newEncrypted, svcToken));

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        stage: 'update',
        message: result.msg || 'Change password failed.',
        meta: { flag: result.flag },
      });
    }

    return res.json({ ok: true, message: 'Password changed successfully.' });
  } catch (e) {
    if (e?.response) {
      return res.status(502).json({
        ok: false,
        message: 'Upstream error during change password',
        status: e.response.status,
        data: typeof e.response.data === 'string' ? e.response.data.slice(0, 300) : e.response.data,
      });
    }
    return res.status(500).json({ ok: false, message: 'Server error while changing password.' });
  }
});

module.exports = router;
