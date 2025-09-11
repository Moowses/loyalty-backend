// routes/auth.js
const express = require('express');
const router = express.Router();
const { getToken } = require('../services/getToken');
const axios = require('axios');
const qs = require('qs');
const https = require('https');

const API_BASE = 'https://servicehub.metasphere.global:8966/api/';
const agent = new https.Agent({ rejectUnauthorized: false });
const COOKIE_NAME = process.env.COOKIE_NAME || 'dtc_session';

// Cookie configuration
function cookieOptions(req) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

const crypto = require('crypto');

/** LOGIN */
/** LOGIN (flag-aware responses + cookie preserved) */
router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      loggedIn: false,
      flag: 1,
      message: 'Email and password are required.',
    });
  }

  // Map upstream flags to HTTP status + user-friendly messages
  const FLAG_MAP = {
    '0': { status: 200, message: 'Login successful.' },
    '1': { status: 422, message: 'Request validation failed. Please check your inputs.' },
    '3': { status: 404, message: 'Membership email does not exist.' },
    '4': { status: 502, message: 'System error. Please try again later.' },
    '5': { status: 401, message: 'Incorrect membership password.' },
    '7': { status: 409, message: 'Multiple profiles are associated with this email. Please try using the membership number.' },
  };

  try {
    const token = await getToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        loggedIn: false,
        flag: 4,
        message: 'Could not retrieve access token.',
      });
    }

    const hashedPwd = crypto.createHash('sha256').update(password, 'utf8').digest('hex');

    const loginUrl = `${API_BASE}LoginthroughEmail?` + qs.stringify({
      email,
      membershippwd: hashedPwd,
      flag: '0',
      token,
    });

    const response = await axios.post(loginUrl, {}, { httpsAgent: agent });
    const upstreamFlag = String(response?.data?.flag ?? '');

    // Fallback in case API schema changes
    const mapping = FLAG_MAP[upstreamFlag] || {
      status: 500,
      message: 'Unexpected login response. Please try again.',
    };

    if (upstreamFlag === '0') {
      // Success: set your session cookie (same behavior as before)
      res.cookie(COOKIE_NAME, 'user-authenticated', cookieOptions(req));

      // You can optionally persist a lightweight identifier for FE use:
      // res.cookie('dtc_email', email, { ...cookieOptions(req), httpOnly: false });

      return res.status(mapping.status).json({
        success: true,
        loggedIn: true,
        flag: 0,
        message: mapping.message,
      });
    }

    // Helpful per-flag hints (optional but nice UX)
    let hint;
    if (upstreamFlag === '3') hint = 'Check for typos or try signing up.';
    else if (upstreamFlag === '5') hint = 'Double-check your password or reset it if you forgot.';
    else if (upstreamFlag === '7') hint = 'Try logging in with your membership number.';

    return res.status(mapping.status).json({
      success: false,
      loggedIn: false,
      flag: Number.isNaN(Number(upstreamFlag)) ? undefined : Number(upstreamFlag),
      message: mapping.message,
      ...(hint ? { hint } : {}),
    });
  } catch (error) {
  console.error('Login error:', error?.message || error);

  const upstreamFlag = String(error?.response?.data?.flag ?? '');
  if (upstreamFlag && upstreamFlag in FLAG_MAP) {
    const mapping = FLAG_MAP[upstreamFlag];
    return res.status(mapping.status).json({
      success: false,
      loggedIn: false,
      flag: Number(upstreamFlag),  
      message: mapping.message,     
    });
  }

  return res.status(500).json({
    success: false,
    loggedIn: false,
    flag: 4,
    message: 'Server error while processing login. Please try again.',
  });
}

});


/** ME endpoint - SIMPLIFIED FOR NOW */
router.get('/me', (req, res) => {
  const hasSession = req.cookies && req.cookies[COOKIE_NAME];
  return res.json({ 
    loggedIn: !!hasSession,
    message: hasSession ? 'User authenticated' : 'Not authenticated'
  });
});

/** LOGOUT */
/** LOGOUT */
router.post('/logout', (req, res) => {
  // Clear your session cookie
  res.clearCookie(COOKIE_NAME, { path: '/' });

  // Optional: if you set other cookies with Domain=.dreamtripclub.com, expire them too
  const baseCookie = 'Path=/; Domain=.dreamtripclub.com; Secure; SameSite=None';
  res.setHeader('Set-Cookie', [
    `session=; Max-Age=0; ${baseCookie}`,
    `refresh=; Max-Age=0; ${baseCookie}`,
  ]);

  // This tells the browser to clear storage for this origin (localStorage, sessionStorage, IndexedDB, cache, cookies)
  res.setHeader('Clear-Site-Data', '"cookies", "storage", "cache"');

  // CORS headers so WP or other subdomains can call this
  res.setHeader('Access-Control-Allow-Origin', 'https://dreamtripclub.com');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  return res.status(204).end(); // No content
});


module.exports = router;