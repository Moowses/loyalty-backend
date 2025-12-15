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
    secure: true,         
    sameSite: 'None',       
    domain: '.dreamtripclub.com',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

const crypto = require('crypto');
// Login endpoint
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

  // Map upstream flags
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

// log in status check
router.get('/status', (req, res) => {
  const hasSession = !!(req.cookies && req.cookies[COOKIE_NAME]);
  if (!hasSession) return res.status(401).json({ ok: false });
  return res.json({ ok: true });
});


/** ME endpoint - Coockies*/
router.get('/me', (req, res) => {
  const hasSession = req.cookies && req.cookies[COOKIE_NAME];
  return res.json({ 
    loggedIn: !!hasSession,
    message: hasSession ? 'User authenticated' : 'Not authenticated'
  });
});

/** LOGOUT */
router.post('/logout', (req, res) => {
  const baseCookie = {
    path: '/',
    domain: '.dreamtripclub.com', // important so it clears across member.dreamtripclub.com and dreamtripclub.com
    secure: true,
    sameSite: 'None',
  };

  // clear the httpOnly session cookie
  res.clearCookie(COOKIE_NAME, baseCookie);

  // clear the profile cookies (non-httpOnly, accessible to client JS)
  res.clearCookie('dtc_firstName', baseCookie);
  res.clearCookie('dtc_lastName', baseCookie);
  res.clearCookie('dtc_email', baseCookie);
  res.clearCookie('dtc_membershipNo', baseCookie);

  // tell browser to clear site data (extra belt & suspenders)
  res.setHeader('Clear-Site-Data', '"cookies", "storage", "cache"');

  return res.json({ success: true, loggedIn: false });
});

module.exports = router;