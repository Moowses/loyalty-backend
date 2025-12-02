// routes/kext-external-ref.js
const express = require('express');
const router = express.Router();



router.post('/external-ref', async (req, res) => {
  const { externalReference, receiptNumber, posContext } = req.body || {};

  if (!externalReference) {
    return res.status(400).json({ ok: false, error: 'Missing externalReference' });
  }

  let membershipId = null;

  // If prefixed, strip the prefix
  const prefixed = /^DreamTripMember-(.+)$/.exec(externalReference);
  if (prefixed) {
    membershipId = prefixed[1];
  } else {
    // Otherwise just treat the externalReference itself as the membershipId
    membershipId = String(externalReference).trim();
  }

  const payload = {
    membershipId,
    externalReference,
    receiptNumber: receiptNumber || null,
    posContext: posContext || null,
    ts: new Date().toISOString(),
  };

  console.log('[KEXT] Received external ref:', payload);

  return res.json({ ok: true });
});



module.exports = router;
