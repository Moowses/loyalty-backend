require('dotenv').config();
const {
  providerTokenManager,
  createInsecureAxiosClient,
  buildProviderTokenRefresh,
} = require('./metasphereAuth');

const UAT_API_BASE_URL = 'https://crm.metasphere.global:8958/api/';
const UAT_TOKEN_URL = 'https://crm.metasphere.global:8958/api/getToken';
const UAT_PROVIDER_KEY = 'metasphere-uat';

const api = createInsecureAxiosClient(UAT_API_BASE_URL);
const refreshUatToken = buildProviderTokenRefresh({
  provider: UAT_PROVIDER_KEY,
  tokenUrl: UAT_TOKEN_URL,
});

async function getTokenUAT() {
  try {
    const result = await providerTokenManager.getTokenResult(UAT_PROVIDER_KEY, refreshUatToken);
    return {
      random: result.random || null,
      sign: result.sign || null,
      token: result.token,
    };
  } catch (err) {
    console.error('UAT token error:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = {
  getTokenUAT,
  api,
  refreshUatToken,
  UAT_PROVIDER_KEY,
};
