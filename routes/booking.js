const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const { getToken } = require('../services/getToken');

const apiBaseUrl = process.env.API_BASE_URL; 
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Helper: normalize yes/no for pet
 */
function asYesNo(value, fallback = 'no') {
  const v = String(value ?? '').toLowerCase();
  if (v === 'yes' || v === 'no') return v;
  if (v === 'true' || v === '1') return 'yes';
  if (v === 'false' || v === '0') return 'no';
  return fallback;
}

/**
 * - If hotelId is present -> 6.3 GetRateAndAvailability_Moblie (hotel-specific)
 * - Else if lat/lng present -> 6.10 getHotelRoomInfo (nearby list)
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

  // guests normalization
  const A = Number(adults ?? adult ?? 1);
  const C = Number(children ?? child ?? 0);
  const I = Number(infant ?? 0);
  const PET = asYesNo(pet, 'no');

  try {
    const token = await getToken();
    if (!token) return res.status(500).json({ success: false, message: 'Could not retrieve access token' });

    if (hotelId) {
    
      const params = {
        token,
        hotelId,
        startTime: ci,
        endTime: co,
        adults: A,
        children: C,
        infaut: I,               // API expects "infaut" (not "infant")
        pet: PET
      };

      const response = await axios.post(
        apiBaseUrl + 'GetRateAndAvailability_Moblie',
        null,
        { params, httpsAgent }
      );

      return res.json({
        success: true,
        data: response.data
      });

    } else if (lng && lat) {
      // 6.10: Nearby hotels by lat/lng 
 
      const form = qs.stringify({
        startDate: ci,
        endDate: co,
        lng,
        lat,
        adult: A,
        child: C,
        infant: I,
        pet: PET,
        flag: 0,
        token
      });

      const response = await axios.post(
        apiBaseUrl + 'getHotelRoomInfo',
        form,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
      );

      return res.json({
        success: true,
        data: response.data
      });

    } else {
      return res.status(400).json({ success: false, message: 'Missing required parameters: either hotelId OR lat/lng.' });
    }
  } catch (err) {
    console.error('Availability API error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch availability', error: err.response?.data || err.message });
  }
});

/**
 * POST /api/booking/check-member
 * check if email is in CRM (3.1 GetPrivateProfile).
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
 * POST /api/booking/create-reservation
 * Proxy to CreateReservation 
 * Ionly inject the token and forward as x-www-form-urlencoded.
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
      apiBaseUrl + 'CreateReservation',
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
