// routes/reset-password.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const { getToken } = require('../services/getToken');

// Keep base URL + agent consistent with the rest of your routes
const apiBaseUrl = (process.env.API_BASE_URL || process.env.CRM_BASE_URL || '').replace(/\/+$/, '') + '/';
const httpsAgent = String(process.env.ALLOW_INSECURE_SSL || 'false') === 'true'
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

// Friendly messages
const FLAG_TO_MESSAGE = {
  '0': 'Password reset successful.',
  '-1': 'Invalid email or a temporary system issue. Please check your email and try again.',
};

// helper: call vendor once with a given hex hash
async function callReset({ email, hex, token }) {
  const url = `${apiBaseUrl}ResetPasswordProfile?email=${encodeURIComponent(email)}&newPassword=${encodeURIComponent(hex)}&token=${encodeURIComponent(token)}`;
  const resp = await axios.post(url, null, { httpsAgent });
  const data = resp?.data || {};
  const flag = String(data?.flag ?? '');
  const msg  = String(data?.msg || '');
  return { ok: flag === '0' || msg.toLowerCase() === 'success', flag, msg, data };
}

/**
 * POST /api/auth/reset-password
 * Body: { email, newPassword }
 */
router.post('/', async (req, res) => {
  const em = String(req.body?.email || '').trim().toLowerCase();
  const pw = String(req.body?.newPassword || '').trim();

  if (!em || !pw) {
    return res.status(400).json({ success: false, message: 'Email and new password are required.' });
  }

  try {
    const token = await getToken();
    if (!token) return res.status(502).json({ success: false, message: 'Upstream token unavailable' });

    // 1) Prefer SHA-256 to match login/signup
    const sha256 = crypto.createHash('sha256').update(pw, 'utf8').digest('hex');
    let attempt = await callReset({ email: em, hex: sha256, token });

    // 2) If not accepted upstream, fall back to MD5 (per vendor PDF example)
    if (!attempt.ok) {
      const md5 = crypto.createHash('md5').update(pw, 'utf8').digest('hex');
      attempt = await callReset({ email: em, hex: md5, token });
      if (attempt.ok) {
        return res.json({
          success: true,
          message: FLAG_TO_MESSAGE['0'],
          meta: { usedAlgorithm: 'md5' } // for logs/diagnostics
        });
      }
    } else {
      return res.json({
        success: true,
        message: FLAG_TO_MESSAGE['0'],
        meta: { usedAlgorithm: 'sha256' } // for logs/diagnostics
      });
    }

    // Non-success after both tries
    const friendly = FLAG_TO_MESSAGE[attempt.flag] || 'Password reset failed. Please try again later.';
    return res.status(400).json({
      success: false,
      message: friendly,
      meta: { flag: attempt.flag, msg: attempt.msg }
    });
  } catch (err) {
    if (err.response) {
      const r   = err.response.data || {};
      const msg = String(r?.msg || r?.message || 'CRM error');
      return res.status(err.response.status || 502).json({ success: false, message: msg });
    }
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Unexpected error. Try again.' });
  }
});

module.exports = router;
