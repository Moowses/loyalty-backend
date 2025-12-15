// services/getTokenUAT.js
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

// Axios instance for UAT API (SSL OFF)
const api = axios.create({
  baseURL: 'https://crm.metasphere.global:8958/api/',
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
});

const getTokenUAT = async () => {
  const random = generateRandom32Digits();
  const sign = generateSign(appKey, random, appSecret);

  console.log('Requesting UAT token...');
  console.log('UAT random:', random);
  console.log('UAT sign:', sign);

  try {
    const response = await axios.post(
      'https://crm.metasphere.global:8958/api/getToken',
      new URLSearchParams({ appKey, random, sign }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    const data = response.data;

    if (data && data.accessToken) {
      console.log('UAT token received:', data.accessToken);

      return {
        random,
        sign,
        token: data.accessToken,
      };
    }

    console.error('UAT token fetch failed:', data);
    throw new Error('UAT token fetch failed');
  } catch (err) {
    console.error('UAT token error:', err.response?.data || err.message);
    throw err;
  }
};

module.exports = {
  getTokenUAT,
  api,
};
