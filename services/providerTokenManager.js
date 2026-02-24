class ProviderTokenManager {
  constructor({ expirySkewMs = 120000 } = {}) {
    this.cache = new Map();
    this.expirySkewMs = expirySkewMs;
  }

  getEntry(provider) {
    let entry = this.cache.get(provider);
    if (!entry) {
      entry = {
        token: null,
        expiresAt: 0,
        refreshPromise: null,
        lastResult: null,
      };
      this.cache.set(provider, entry);
    }
    return entry;
  }

  isValid(entry) {
    return Boolean(entry.token) && Date.now() < (entry.expiresAt - this.expirySkewMs);
  }

  log(event, provider) {
    if (process.env.NODE_ENV === 'test') return;
    console.log(`[token-manager] ${event} provider=${provider}`);
  }

  normalizeRefreshResult(result) {
    if (!result || !result.token) {
      throw new Error('Token refresh did not return a token');
    }

    const expiresAt = Number.isFinite(result.expiresAtMs)
      ? result.expiresAtMs
      : Date.now() + ((Number(result.expiresInSec) || 900) * 1000);

    return {
      token: result.token,
      expiresAt,
      result: {
        ...result,
        expiresAtMs: expiresAt,
      },
    };
  }

  async getTokenResult(provider, refreshFn) {
    const entry = this.getEntry(provider);

    if (this.isValid(entry) && entry.lastResult) {
      this.log('cache_hit', provider);
      return entry.lastResult;
    }

    if (entry.refreshPromise) {
      this.log('refresh_join', provider);
      return entry.refreshPromise;
    }

    this.log('refresh_start', provider);

    entry.refreshPromise = (async () => {
      const normalized = this.normalizeRefreshResult(await refreshFn());
      entry.token = normalized.token;
      entry.expiresAt = normalized.expiresAt;
      entry.lastResult = normalized.result;
      return entry.lastResult;
    })();

    try {
      return await entry.refreshPromise;
    } finally {
      entry.refreshPromise = null;
    }
  }

  async getToken(provider, refreshFn) {
    const result = await this.getTokenResult(provider, refreshFn);
    return result.token;
  }

  invalidate(provider) {
    const entry = this.getEntry(provider);
    entry.token = null;
    entry.expiresAt = 0;
    entry.lastResult = null;
    this.log('invalidated', provider);
  }
}

const providerTokenManager = new ProviderTokenManager({
  expirySkewMs: Number(process.env.PROVIDER_TOKEN_EXPIRY_SKEW_MS || 120000),
});

async function callWithProviderAuth({
  provider,
  refreshFn,
  doRequest,
  isUnauthorizedError,
  tokenManager = providerTokenManager,
}) {
  const isUnauthorized = typeof isUnauthorizedError === 'function'
    ? isUnauthorizedError
    : () => false;

  let token = await tokenManager.getToken(provider, refreshFn);

  try {
    return await doRequest(token);
  } catch (err) {
    if (!isUnauthorized(err)) throw err;

    tokenManager.invalidate(provider);
    token = await tokenManager.getToken(provider, refreshFn);
    return await doRequest(token);
  }
}

module.exports = {
  ProviderTokenManager,
  providerTokenManager,
  callWithProviderAuth,
};
