// routes/request-password-reset.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const sgMail = require('@sendgrid/mail');
const { getToken } = require('../services/getToken');

// ---- Config ----
const apiBaseUrl = (process.env.API_BASE_URL || process.env.CRM_BASE_URL || '').replace(/\/+$/, '') + '/';
const httpsAgent = String(process.env.ALLOW_INSECURE_SSL || 'false') === 'true'
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

const APP_ORIGIN = (process.env.PUBLIC_APP_ORIGIN || 'https://member.dreamtripclub.com').replace(/\/+$/, '');
const FROM = process.env.SENDGRID_FROM || 'Dream Trip Club <no-reply@dreamtripclub.com>';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('[request-password-reset] WARNING: SENDGRID_API_KEY is not set');
}

// ---- Helpers ----
async function verifyMember(email) {
  const token = await getToken();
  if (!token) throw new Error('Upstream token unavailable');

  // Per vendor spec: POST with query string params
  // GetPrivateProfile?email=...&flag=0&token=...
  const url = `${apiBaseUrl}GetPrivateProfile?email=${encodeURIComponent(email)}&flag=0&token=${encodeURIComponent(token)}`;
  const resp = await axios.post(url, null, { httpsAgent });
  const data = resp?.data || {};
  const isSuccess = String(data?.result || '').toLowerCase() === 'success' && String(data?.flag) === '0';
  return { ok: isSuccess, raw: data };
}

async function sendResetEmail(toEmail) {
  const link = `${APP_ORIGIN}/resetpassword?email=${encodeURIComponent(toEmail)}`;

  const msg = {
    to: toEmail,
    from: FROM,
    subject: 'Reset your Dream Trip Club password',
    text: [
      'Hello,',
      '',
      'This is your reset password link:',
      link,
      '',
      'If you did not request this, please ignore this email.'
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>This is your reset password link:</p>
      <p><a href="${link}">${link}</a></p>
      <p>If you did not request this, please ignore this email.</p>
    `,
  };

  await sgMail.send(msg);
}

// ---- Route ----
/**
 * POST /api/auth/request-password-reset
 * Body: { email }
 */
router.post('/', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  try {
    // 1) Verify membership first
    const check = await verifyMember(email);
    if (!check.ok) {
      return res.status(404).json({ success: false, message: 'Membership email does not exist.' });
    }

    // 2) Send the reset email with /resetpassword?email=
    await sendResetEmail(email);

    // 3) Success
    return res.json({ success: true, message: `Reset link sent to ${email}.` });
  } catch (err) {
    // Axios upstream errors
    if (err?.response) {
      const status = err.response.status || 502;
      const body = err.response.data || {};
      const msg = String(body?.message || body?.msg || 'Upstream error');
      return res.status(status).json({ success: false, message: msg });
    }

    // SendGrid or unexpected errors
    console.error('request-password-reset error:', err);
    return res.status(500).json({ success: false, message: 'Unable to send reset link. Please try again later.' });
  }
});

module.exports = router;