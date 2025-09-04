// routes/auth.js
const express = require('express');
const router = express.Router();
const { getToken } = require('../services/getToken');
const axios = require('axios');
const qs = require('qs');
const https = require('https');

const API_BASE = 'https://servicehub.metasphere.global:8966/api/';
const agent = new https.Agent({ rejectUnauthorized: false });

// ---- Cookie config (env-driven) ----
const isProd = process.env.NODE_ENV === 'production';

// prefer new env name; fall back to legacy if present
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || process.env.COOKIE_NAME || 'dtc_session';

// Defaults: in prod, cross-site cookie (.dreamtripclub.com, SameSite=None, Secure)
// in dev, localhost-friendly (no domain, SameSite=Lax, Secure=false)
function cookieOptions() {
  return {
    httpOnly: true,
    secure: (process.env.SESSION_COOKIE_SECURE ?? (isProd ? 'true' : 'false')) === 'true',
    sameSite: process.env.SESSION_COOKIE_SAMESITE || (isProd ? 'None' : 'Lax'),
    domain: process.env.SESSION_COOKIE_DOMAIN || (isProd ? '.dreamtripclub.com' : undefined),
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/** LOGIN */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const token = await getToken();
    if (!token) {
      return res.status(500).json({ success: false, message: 'Could not retrieve access token' });
    }

    const loginUrl = `${API_BASE}LoginthroughEmail?` + qs.stringify({
      email,
      membershippwd: password,
      flag: '0',
      token
    });

    const response = await axios.post(loginUrl, {}, { httpsAgent: agent });

    if (response.data.flag === '0') {
      // Set cross-site session cookie
      res.cookie(COOKIE_NAME, 'user-authenticated', cookieOptions());
      return res.json({ success: true, loggedIn: true, message: 'Login successful' });
    } else {
      return res.status(401).json({ success: false, loggedIn: false, message: 'Login failed' });
    }
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ success: false, loggedIn: false, message: 'Server error' });
  }
});

/** ME */
router.get('/me', (req, res) => {
  const hasSession = req.cookies && req.cookies[COOKIE_NAME];
  return res.json({
    loggedIn: !!hasSession,
    message: hasSession ? 'User authenticated' : 'Not authenticated'
  });
});

/** LOGOUT */
router.post('/logout', (req, res) => {
  // IMPORTANT: match domain/path to actually clear the cookie
  const opts = cookieOptions();
  res.clearCookie(COOKIE_NAME, { path: '/', domain: opts.domain });
  return res.json({ success: true, loggedIn: false });
});

module.exports = router;
