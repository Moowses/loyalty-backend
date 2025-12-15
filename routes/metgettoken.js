// routes/uat-tools.js
const express = require('express');
const router = express.Router();

const { getTokenVc } = require('../services/getTokenVc');

router.get('/get-token', async (req, res) => {
  try {
    const { random, sign, token } = await getTokenVc();

    return res.json({
      ok: true,
      random,
      sign,
      token,
    });
  } catch (err) {
    console.error('get-token error:', err.message);
    return res.status(500).json({
      ok: false,
      message: 'Failed to get token',
      error: err.message,
    });
  }
});

module.exports = router;
