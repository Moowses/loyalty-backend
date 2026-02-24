require('dotenv').config();
const {
  providerTokenManager,
  createInsecureAxiosClient,
  buildProviderTokenRefresh,
} = require('./metasphereAuth');
const { PROD_PROVIDER_KEY } = require('./getToken');

const PROD_API_BASE_URL = 'https://servicehub.metasphere.global:8966/api/';
const PROD_TOKEN_URL = 'https://servicehub.metasphere.global:8966/api/getToken';
const PROD_VC_PROVIDER_KEY = PROD_PROVIDER_KEY;

const api = createInsecureAxiosClient(PROD_API_BASE_URL);
const refreshProdVcToken = buildProviderTokenRefresh({
  provider: PROD_VC_PROVIDER_KEY,
  tokenUrl: PROD_TOKEN_URL,
});

async function getTokenVc() {
  try {
    const result = await providerTokenManager.getTokenResult(PROD_VC_PROVIDER_KEY, refreshProdVcToken);
    return {
      random: result.random || null,
      sign: result.sign || null,
      token: result.token,
    };
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = {
  getTokenVc,
  api,
  refreshProdVcToken,
  PROD_VC_PROVIDER_KEY,
};
