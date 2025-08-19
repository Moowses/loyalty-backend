// routes/auth.js
const express = require('express');
const router = express.Router();
const { getToken } = require('../services/getToken');
const axios = require('axios');
const qs = require('qs');
const https = require('https');

const API_BASE = 'https://servicehub.metasphere.global:8966/api/';
const agent = new https.Agent({ rejectUnauthorized: false });

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const token = await getToken();
    if (!token) return res.status(500).json({ success: false, message: 'Could not retrieve access token' });

    const loginUrl = `${API_BASE}LoginthroughEmail?` + qs.stringify({
      email,
      membershippwd: password,
      flag: '0',
      token
    });

    const response = await axios.post(loginUrl, {}, { httpsAgent: agent });

    if (response.data.flag === '0') {
      return res.json({ success: true, message: 'Login successful', result: response.data });
    } else {
      return res.status(401).json({ success: false, message: 'Login failed', result: response.data });
    }

  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

module.exports = router;