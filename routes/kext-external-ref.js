// routes/kext-external-ref.js
const express = require('express');
const router = express.Router();



router.post('/external-ref', (req, res) => {
  const { externalReference, receiptNumber, posContext } = req.body || {};

  if (!externalReference) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing externalReference' });
  }

  // Example: you can log or persist this
  console.log('[KEXT] Received external reference:', {
    externalReference,
    receiptNumber: receiptNumber || null,
    posContext: posContext || null,
    ts: new Date().toISOString(),
  });

  return res.json({ ok: true });
});

module.exports = router;
