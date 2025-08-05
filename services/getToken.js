// services/getToken.js
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

const appKey = '41787349523ac4f6';
const appSecret = 'ftObPzm7cQyv2jpyxH9BXd3vBCr8Y-FGIoQsBRMpeX8';

// SHA256(appSecret + appKey + random)
function generateSign(appKey, random, appSecret) {
  const raw = appSecret + appKey + random;
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest();
  return Buffer.from(hash).toString('base64');
}

function generateRandom32Digits() {
  let result = '';
  while (result.length < 32) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
}

// Axios instance for API with SSL off
const api = axios.create({
  baseURL: 'https://servicehub.metasphere.global:8966/api/',
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
});

const getToken = async () => {
  const random = generateRandom32Digits();
  const sign = generateSign(appKey, random, appSecret);

  console.log('Requesting token...');
  console.log('Random:', random);
  console.log('Sign:', sign);

  try {
    const response = await axios.post(
      'https://servicehub.metasphere.global:8966/api/getToken',
      new URLSearchParams({ appKey, random, sign }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    const data = response.data;
    if (data && data.accessToken) {
      console.log('Token received:', data.accessToken);
      return data.accessToken;
    } else {
      console.error('Token fetch failed:', data);
      return null;
    }
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    return null;
  }
};

module.exports = {
  getToken,
  api
};