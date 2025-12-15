// routes/uat-tools.js
const express = require('express');
const router = express.Router();

const { getTokenUAT } = require('../services/getTokenUAT');

router.get('/get-token', async (req, res) => {
  try {
    const { random, sign, token } = await getTokenUAT();

    return res.json({
      ok: true,
      env: 'uat',
      random,
      sign,
      token,
    });
  } catch (err) {
    console.error('UAT tools get-token error:', err.message);
    return res.status(500).json({
      ok: false,
      message: 'Failed to get UAT token',
      error: err.message,
    });
  }
});

module.exports = router;
