// routes/kext-external-ref.js
const express = require('express');
const router = express.Router();



router.post('/external-ref', async (req, res) => {
  const { externalReference, receiptNumber, posContext } = req.body || {};

  if (!externalReference) {
    return res.status(400).json({ ok: false, error: 'Missing externalReference' });
  }

  // Extract membershipId if it follows DreamTripMember-<id>
  let membershipId = null;
  const m = /^DreamTripMember-(.+)$/.exec(externalReference);
  if (m) membershipId = m[1];

  // Example: log or save to DB
  const payload = {
    membershipId,
    externalReference,
    receiptNumber: receiptNumber || null,
    posContext: posContext || null,
    ts: new Date().toISOString(),
  };

  console.log('[KEXT] Received external ref:', payload);

  // TODO: insert into DB / send to loyalty service, etc.
  // await db.LoyaltyLinks.insert(payload);

  return res.json({ ok: true });
});


module.exports = router;
