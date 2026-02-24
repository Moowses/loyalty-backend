require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const { providerTokenManager, callWithProviderAuth } = require('./providerTokenManager');

const DEFAULT_APP_KEY = process.env.METASPHERE_APP_KEY || '41787349523ac4f6';
const DEFAULT_APP_SECRET = process.env.METASPHERE_APP_SECRET || 'ftObPzm7cQyv2jpyxH9BXd3vBCr8Y-FGIoQsBRMpeX8';
const DEFAULT_TOKEN_TTL_SEC = 7200;

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
  return result.slice(0, 32);
}

function createInsecureAxiosClient(baseURL) {
  return axios.create({
    baseURL,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
}

function buildProviderTokenRefresh({ provider, tokenUrl, appKey = DEFAULT_APP_KEY, appSecret = DEFAULT_APP_SECRET }) {
  return async function refreshToken() {
    const random = generateRandom32Digits();
    const sign = generateSign(appKey, random, appSecret);

    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({ appKey, random, sign }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    const data = response.data || {};
    if (!data.accessToken) {
      throw new Error(`${provider} token fetch failed`);
    }

    return {
      token: data.accessToken,
      expiresInSec: Number(data.expireIn) || DEFAULT_TOKEN_TTL_SEC,
      expiresAtMs: Number(data.expireTime) || undefined,
      random,
      sign,
      generateTime: data.generateTime,
      expireTime: data.expireTime,
    };
  };
}

function getErrorText(err) {
  const parts = [
    err && err.message,
    err && err.response && err.response.data && err.response.data.message,
    err && err.response && err.response.data && err.response.data.Message,
    err && err.response && err.response.data && err.response.data.response,
  ];
  return parts.filter(Boolean).join(' | ').toLowerCase();
}

function isMetasphereUnauthorizedError(err) {
  const status = err && err.response && err.response.status;
  if (status === 401) return true;
  if (err && err.code === 'PROVIDER_UNAUTHORIZED') return true;

  const text = getErrorText(err);
  return /(unauthorized|invalid token|token invalid|token expired|expire token|access token)/i.test(text);
}

function throwIfMetasphereUnauthorizedResponse(response) {
  const data = response && response.data;
  if (!data || typeof data !== 'object') return;

  const joined = [
    data.message,
    data.Message,
    data.response,
    data.result,
    data.flag,
  ].filter((v) => v !== undefined && v !== null).join(' ').toLowerCase();

  if (/(unauthorized|invalid token|token invalid|token expired|expire token)/i.test(joined)) {
    const err = new Error(data.message || data.Message || 'Provider token unauthorized');
    err.code = 'PROVIDER_UNAUTHORIZED';
    err.response = response;
    throw err;
  }
}

async function postWithProviderToken({
  provider,
  refreshFn,
  url,
  body = null,
  params = {},
  axiosConfig = {},
}) {
  return callWithProviderAuth({
    provider,
    refreshFn,
    isUnauthorizedError: isMetasphereUnauthorizedError,
    doRequest: async (token) => {
      const response = await axios.post(url, body, {
        ...axiosConfig,
        params: {
          ...params,
          token,
        },
      });
      throwIfMetasphereUnauthorizedResponse(response);
      return response;
    },
  });
}

module.exports = {
  providerTokenManager,
  callWithProviderAuth,
  createInsecureAxiosClient,
  buildProviderTokenRefresh,
  postWithProviderToken,
  isMetasphereUnauthorizedError,
  throwIfMetasphereUnauthorizedResponse,
};
