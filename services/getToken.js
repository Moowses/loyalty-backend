require('dotenv').config();
const {
  providerTokenManager,
  createInsecureAxiosClient,
  buildProviderTokenRefresh,
  callWithProviderAuth,
  isMetasphereUnauthorizedError,
  throwIfMetasphereUnauthorizedResponse,
} = require('./metasphereAuth');

const PROD_API_BASE_URL = 'https://servicehub.metasphere.global:8966/api/';
const PROD_TOKEN_URL = 'https://servicehub.metasphere.global:8966/api/getToken';
const PROD_PROVIDER_KEY = 'metasphere-prod';

const api = createInsecureAxiosClient(PROD_API_BASE_URL);
const refreshProdToken = buildProviderTokenRefresh({
  provider: PROD_PROVIDER_KEY,
  tokenUrl: PROD_TOKEN_URL,
});

async function getToken() {
  try {
    return await providerTokenManager.getToken(PROD_PROVIDER_KEY, refreshProdToken);
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    return null;
  }
}

async function withProdTokenRetry(doRequest) {
  return callWithProviderAuth({
    provider: PROD_PROVIDER_KEY,
    refreshFn: refreshProdToken,
    isUnauthorizedError: isMetasphereUnauthorizedError,
    doRequest: async (token) => {
      const result = await doRequest(token);
      if (result && result.data) {
        throwIfMetasphereUnauthorizedResponse(result);
      }
      return result;
    },
  });
}

module.exports = {
  getToken,
  api,
  refreshProdToken,
  PROD_PROVIDER_KEY,
  withProdTokenRetry,
};
