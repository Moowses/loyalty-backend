const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const { getToken } = require('../services/getToken');

const apiBaseUrl = process.env.API_BASE_URL;
const httpsAgent =  process.env.NODE_ENV === 'production'
   ? undefined
   : new https.Agent({ rejectUnauthorized: false });

/** normalize yes/no for pet (your old pattern) */
function asYesNo(value, fallback = 'no') {
  const v = String(value ?? '').toLowerCase();
  if (v === 'yes' || v === 'no') return v;
  if (v === 'true' || v === '1') return 'yes';
  if (v === 'false' || v === '0') return 'no';
  return fallback;
}

/**
 * GET /api/booking/availability
 * - If hotelId present → GetRateAndAvailability_Moblie (hotel-specific)
 * - Else if lat/lng present → getHotelRoomInfo (nearby list)
 *   Carries infants + pets through (pets as yes/no per your working version)
 */
router.get('/availability', async (req, res) => {
  const {
    hotelId,
    startDate, endDate, startTime, endTime,
    lng, lat,
    adult, adults,
    child, children,
    infant,
    pet
  } = req.query;

  const ci = startDate || startTime;
  const co = endDate || endTime;

  if (!ci || !co) {
    return res.status(400).json({ success: false, message: 'Missing required dates (startDate/startTime and endDate/endTime).' });
  }

  const A = Number(adults ?? adult ?? 1);
  const C = Number(children ?? child ?? 0);
  const I = Number(infant ?? 0);
  const PET = asYesNo(pet, 'no');

  try {
    const token = await getToken();
    if (!token) return res.status(500).json({ success: false, message: 'Could not retrieve access token' });

    if (hotelId) {
      const params = {
        token, hotelId,
        startTime: ci, endTime: co,
        adults: A, children: C,
        infaut: I,  // keeping your working param name
        pet: PET
      };
      const response = await axios.post(apiBaseUrl + 'GetRateAndAvailability_Moblie', null, { params, httpsAgent });
      return res.json({ success: true, data: response.data });
    } else if (lng && lat) {
      const form = qs.stringify({
        startDate: ci, endDate: co, lng, lat,
        adult: A, child: C, infant: I, pet: PET,
        flag: 0, token
      });
      const response = await axios.post(apiBaseUrl + 'getHotelRoomInfo', form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent
      });
      return res.json({ success: true, data: response.data });
    } else {
      return res.status(400).json({ success: false, message: 'Missing required parameters: either hotelId OR lat/lng.' });
    }
  } catch (err) {
    console.error('Availability API error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch availability', error: err.response?.data || err.message });
  }
});

/**
 * POST /api/booking/quote
 * Double-check a single hotel’s current price before payment.
 * Body: { hotelId, startTime, endTime, adults, children }
 * Returns: { quoteId, currency, grossAmount, nights, details[] }
 */
// POST /api/booking/quote
router.post('/quote', async (req, res) => {
  try {
    let { hotelId, hotelNo, startTime, endTime, adults = 1, children = 0 } = req.body;

    // Prefer hotelNo (code) if provided; otherwise assume caller passed the code in hotelId
    const hotelCode = hotelNo || hotelId;
    if (!hotelCode || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'hotelNo (or hotelId as code), startTime, endTime required' });
    }

    const token = await getToken();
    const params = { token, hotelId: hotelCode, startTime, endTime, adults, children };

    const { data } = await axios.post(
      apiBaseUrl + 'GetRateAndAvailability_Moblie',
      null,
      { params, httpsAgent }
    );

    const first = (data?.data || [])[0] || {};
    const petFeeAmount = Number(first.petFeeAmount || 0);

    const quote = {
      quoteId: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      hotelId: hotelCode,
      roomTypeId: first.RoomTypeId,
      rateId: first.RateId,
      currency: first.currencyCode || 'CAD',
      grossAmount: Number(first.GrossAmount || 0),
      petFeeAmount, // <-- now included
      nights: Array.isArray(first.details) ? first.details.length : null,
      details: first.details || [],
      roomTypeName: first.RoomTypeName || '',
      capacity: first.Capacity || '',
      description: first.Description || ''
    };

    return res.json({ success: true, quote, raw: data });
  } catch (err) {
    console.error('Quote error:', err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get quote',
      error: err.response?.data || err.message
    });
  }
});


/**
 * POST /api/booking/confirm
 * Atomic: charge with NMI token → create reservation in Metasphere (pets + infants)
 * Body:
 * {
 *   quote: { hotelId, roomTypeId, startTime, endTime, adults, children, infants, pets, currency, grossAmount, petFeeAmount? },
 *   guest: { firstName, lastName, email, phone, country, city, address, membershipNo? },
 *   payment: { token } // NMI Collect.js payment_token
 * }
 */
      router.post('/confirm', async (req, res) => {
        try {
          const { quote, guest, payment } = req.body;
          if (!payment?.token) {
            return res.status(400).json({ success: false, message: 'Missing payment token' });
          }
        const baseAmount =
        Number(quote?.grossAmount || 0) + Number(quote?.petFeeAmount || 0);
      const currency = String(quote?.currency || 'CAD');
      const debugSecret   = process.env.NMI_OVERRIDE_SECRET; // leave UNSET in prod
      const clientSecret  = req.get('x-debug-override');
      const requested     = Number(req.body?.overrideAmount);
      const allowedValues = new Set([0.5, 1, 5]);  // safe test choices
      const cap           = 5;

      const allowOverride =
        !!debugSecret &&
        clientSecret === debugSecret &&
        allowedValues.has(requested) &&
        requested <= cap &&
        process.env.NODE_ENV !== 'production';

      const chargeAmount = (
        allowOverride && requested > 0 ? requested : baseAmount
      ).toFixed(2);


    // ---- NMI SALE (classic transact.php) ----
    const nmiUrl = (process.env.NMI_API_URL || 'https://secure.nmi.com/api/transact.php').trim();


    const form = new URLSearchParams({
      security_key: (process.env.NMI_API_KEY || 'SGCynJEQ8VjG2D2S2VjsM4XSdmEpGqG8').trim(),
      type: 'sale',
      amount: chargeAmount,
      payment_token: payment.token,
      currency,
      orderid: `BK-${Date.now()}`
    });
    

  

    const { data: nmiRaw } = await axios.post(nmiUrl, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });

    // Parse key=value response
    const nmi = String(nmiRaw)
      .split('&')
      .reduce((acc, pair) => {
        const [k, v] = pair.split('=');
        if (k) acc[decodeURIComponent(k)] = decodeURIComponent(v || '');
        return acc;
      }, {});

    // Approval check
    const approved =
      /approved/i.test(String(nmiRaw)) ||
      nmi.approved === '1' ||
      nmi.response === '1' ||
      /approved/i.test(nmi.resptext || nmi.responsetext || '');

    if (!approved) {
      const msg = nmi.resptext || nmi.responsetext || nmi.message || 'Payment declined';
      return res.status(402).json({ success: false, message: msg, nmi });
    }

    const transactionId = nmi.transactionid || nmi.transaction_id || null;

    // ---- CREATE RESERVATION (Metasphere) ----
    try {
      const msToken = await getToken();
      if (!msToken) {
        return res.status(200).json({
          success: true,
          payment: { transactionId, nmi },
          warning: 'Payment captured, but could not retrieve Metasphere token.'
        });
      }

      const createPayload = {
        hotelId: String(quote.hotelId || ''),
        roomTypeId: String(quote.roomTypeId || ''),
        startTime: String(quote.startTime || ''),
        endTime: String(quote.endTime || ''),
        guestCount: String((+quote.adults || 0) + (+quote.children || 0)),
        FirstName: String(guest.firstName || ''),
        LastName: String(guest.lastName || ''),
        Email: String(guest.email || ''),
        phone: String(guest.phone || ''),
        guestCountry: String(guest.country || ''),
        guestCity: String(guest.city || ''),
        guestAddress: String(guest.address || ''),
        description: 'Web booking',
        adults: String(quote.adults || 0),
        children: String(quote.children || 0),
        infants: String(quote.infants || 0), // per Aug 12 spec
        pets: String(quote.pets || 0),       // per Aug 12 spec
        totalPrice: String(baseAmount.toFixed(2)), // room + pet fee
        currency: currency,
        membershipNo: String(guest.membershipNo || ''),
        token: msToken
      };

      // x-www-form-urlencoded
      const msForm = qs.stringify(createPayload); // <-- renamed to avoid collision
      const msResp = await axios.post(
        apiBaseUrl + 'CreateReservation_Mobile',
        msForm,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
      );

      const reservationNumber =
        msResp?.data?.data?.ReservationNumber ||
        msResp?.data?.ReservationNumber || null;

      if (!reservationNumber) {
        return res.status(200).json({
          success: true,
          payment: { transactionId, nmi },
          reservation: msResp?.data || null,
          warning: 'Payment captured, but reservationNumber missing from Metasphere response.'
        });
      }

      // All good: payment + reservation
      return res.json({
        success: true,
        payment: { transactionId },
        reservation: { reservationNumber }
      });

    } catch (e) {
      console.error('Metasphere reservation error:', e.response?.data || e.message);
      return res.status(200).json({
        success: true,
        payment: { transactionId, nmi },
        warning: 'Payment captured, but Metasphere reservation failed.',
        metasphereError: e.response?.data || e.message
      });
    }

  } catch (err) {
    console.error('Confirm error:', err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to confirm booking',
      error: err.response?.data || err.message,
    });
  }
});


/**
 * (kept) POST /api/booking/check-member
 * Your existing CRM member check.
 */
router.post('/check-member', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

  try {
    const token = await getToken();
    if (!token) return res.status(500).json({ success: false, message: 'Could not retrieve access token' });

    const response = await axios.post(
      apiBaseUrl + 'GetPrivateProfile',
      qs.stringify({ email, flag: 0, token }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
    );

    if (response.data?.flag === '0') {
      return res.json({ success: true, member: true, profile: response.data.data?.[0] || null });
    }
    return res.json({ success: true, member: false, raw: response.data });

  } catch (err) {
    console.error('Member check API error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to check member', error: err.response?.data || err.message });
  }
});

/**
 * (compat) POST /api/booking/create-reservation
 * If some legacy client still calls this, keep it—but recommend using /confirm.
 */
router.post('/create-reservation', async (req, res) => {
  const bookingData = req.body;
  if (!bookingData || typeof bookingData !== 'object') {
    return res.status(400).json({ success: false, message: 'Booking data required' });
  }

  try {
    const token = await getToken();
    if (!token) return res.status(500).json({ success: false, message: 'Could not retrieve access token' });

    const payload = { ...bookingData, token };
    const response = await axios.post(
      apiBaseUrl + 'CreateReservation_Mobile',
      qs.stringify(payload),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
    );

    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('Create Reservation error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to create reservation', error: err.response?.data || err.message });
  }
});

module.exports = router;
