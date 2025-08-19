// routes/payments.js
const express = require('express');
const axios = require('axios');


const router = express.Router();

/** ---------------------- Config with safe fallbacks ---------------------- */
const NMI_API_URL = (process.env.NMI_API_URL || 'https://secure.nmi.com/api/transact.php').trim();
// Derive JSON Payments API base from transact.php URL (works for secure.nmi.com)
const NMI_BASE_JSON = NMI_API_URL.replace(/\/api\/transact\.php$/i, '');
const NMI_API_KEY = (process.env.NMI_API_KEY || 'v4_secret_m6QvSNkJ662VdSR8Zg9QjRTBWJkgz556').trim();

const API_BASE_URL = (process.env.API_BASE_URL || 'https://servicehub.metasphere.global:8966/api/').trim();
const METASPHERE_HMAC_KEY = (process.env.METASPHERE_HMAC_KEY || 'K8#p2Q9v$sY!wE5rT7uX*zA4dG6jH2nL').trim(); // reserved for future use

function headers() {
  return { Authorization: `Bearer ${NMI_API_KEY}`, 'Content-Type': 'application/json' };
}
function paymentsEndpoint(path) {
  // e.g., 'sale', 'authorize', 'capture', 'void', 'refund'
  return `${NMI_BASE_JSON}/api/v1/payments/${path}`;
}

/** ---------------------- Utility ---------------------- */
function ensureAmount(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n <= 0) throw Object.assign(new Error('Invalid amount'), { status: 400 });
  return n.toFixed(2);
}
function ok(res, data) { return res.json({ success: true, ...data }); }
function fail(res, err, def = 'Payment error') {
  const msg = err?.response?.data || err?.message || def;
  const status = err?.status || err?.response?.status || 500;
  console.error('NMI error:', msg);
  return res.status(status).json({ success: false, error: msg });
}

/** ---------------------- Info ---------------------- */
router.get('/info', (_req, res) => {
  res.json({
    message: 'Use NMI Collect.js in the browser to obtain payment_token; submit it here or to /api/booking/confirm.',
    nmiApiUrl: NMI_API_URL,
    jsonBase: `${NMI_BASE_JSON}/api/v1/payments`,
    usingFallback: !process.env.NMI_API_KEY
  });
});

/** ---------------------- SALE (charge immediately) ---------------------- */
/**
 * Body: {
 *   amount, currency="CAD",
 *   paymentToken, orderId?, billing? { email, first_name, last_name, phone, address, city, country, postal? }
 * }
 */
router.post('/sale', async (req, res) => {
  try {
    const { amount, currency = 'CAD', paymentToken, orderId, billing = {} } = req.body;
    if (!paymentToken) return res.status(400).json({ success: false, error: 'paymentToken is required' });

    const body = {
      amount: ensureAmount(amount),
      currency,
      order: { id: orderId || `ORD-${Date.now()}`, description: process.env.NMI_MERCHANT_DESC || 'Sale' },
      payment_token: paymentToken,
      billing
    };

    const { data } = await axios.post(paymentsEndpoint('sale'), body, { headers: headers() });
    if (data.status !== 'approved' && data.approved !== true) {
      return res.status(402).json({ success: false, error: data.message || 'Payment declined', nmi: data });
    }
    return ok(res, { nmi: data });
  } catch (err) { return fail(res, err); }
});

/** ---------------------- AUTHORIZE (hold funds) ---------------------- */
/**
 * Body: { amount, currency="CAD", paymentToken, orderId?, billing? }
 */
router.post('/authorize', async (req, res) => {
  try {
    const { amount, currency = 'CAD', paymentToken, orderId, billing = {} } = req.body;
    if (!paymentToken) return res.status(400).json({ success: false, error: 'paymentToken is required' });

    const body = {
      amount: ensureAmount(amount),
      currency,
      order: { id: orderId || `AUTH-${Date.now()}`, description: process.env.NMI_MERCHANT_DESC || 'Authorization' },
      payment_token: paymentToken,
      billing
    };

    const { data } = await axios.post(paymentsEndpoint('authorize'), body, { headers: headers() });
    if (data.status !== 'approved' && data.approved !== true) {
      return res.status(402).json({ success: false, error: data.message || 'Authorization declined', nmi: data });
    }
    return ok(res, { nmi: data });
  } catch (err) { return fail(res, err); }
});

/** ---------------------- CAPTURE a previous authorization ---------------------- */
/**
 * Body: { transactionId, amount? }
 */
router.post('/capture', async (req, res) => {
  try {
    const { transactionId, amount } = req.body;
    if (!transactionId) return res.status(400).json({ success: false, error: 'transactionId is required' });

    const body = { transaction_id: transactionId };
    if (amount) body.amount = ensureAmount(amount);

    const { data } = await axios.post(paymentsEndpoint('capture'), body, { headers: headers() });
    return ok(res, { nmi: data });
  } catch (err) { return fail(res, err); }
});

/** ---------------------- VOID an auth/sale before settlement ---------------------- */
/**
 * Body: { transactionId }
 */
router.post('/void', async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ success: false, error: 'transactionId is required' });

    const { data } = await axios.post(paymentsEndpoint('void'), { transaction_id: transactionId }, { headers: headers() });
    return ok(res, { nmi: data });
  } catch (err) { return fail(res, err); }
});

/** ---------------------- REFUND a settled sale ---------------------- */
/**
 * Body: { transactionId, amount? }
 */
router.post('/refund', async (req, res) => {
  try {
    const { transactionId, amount } = req.body;
    if (!transactionId) return res.status(400).json({ success: false, error: 'transactionId is required' });

    const body = { transaction_id: transactionId };
    if (amount) body.amount = ensureAmount(amount);

    const { data } = await axios.post(paymentsEndpoint('refund'), body, { headers: headers() });
    return ok(res, { nmi: data });
  } catch (err) { return fail(res, err); }
});

/** ---------------------- Webhook (optional) ---------------------- */
/**
 * Set your NMI webhook to POST to /api/payments/webhook
 * For production, verify the signature header if your account supports it.
 */
router.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  try {
    const payload = req.body?.toString('utf8');
    console.log('[NMI webhook]', payload);
    // TODO: verify signature, persist event, update booking, alert ops, etc.
    return res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send('bad request');
  }
});

module.exports = router;
