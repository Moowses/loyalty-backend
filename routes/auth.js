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
router.post('/login', async (req, res) => {
 const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();

  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const token = await getToken();
    if (!token) {
       return res.status(500).json({ success: false, message: 'Could not retrieve access token' });
    }
    const hashedPwd = crypto.createHash('sha256').update(password, 'utf8').digest('hex');

    const loginUrl = `${API_BASE}LoginthroughEmail?` + qs.stringify({
      email,
      membershippwd: hashedPwd,
      flag: '0',
      token
    });

    const response = await axios.post(loginUrl, {}, { httpsAgent: agent });

    if (response.data.flag === '0') {
      // Set a simple session cookie
      res.cookie(COOKIE_NAME, 'user-authenticated', cookieOptions(req));
      
      return res.json({ 
        success: true, 
        loggedIn: true,
        message: 'Login successful'
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        loggedIn: false,
        message: 'Login failed'
      });
    }

  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ 
      success: false, 
      loggedIn: false,
      message: 'Server error'
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
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ success: true, loggedIn: false });
});

module.exports = router;