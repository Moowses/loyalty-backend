const express = require('express');
const router = express.Router();
const { getToken, api } = require('../services/getToken');
const axios = require('axios');
const https = require('https');
const qs = require('qs');

const apiBaseUrl = process.env.API_BASE_URL || 'https://servicehub.metasphere.global:8966/api/';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * Utility: Normalize various Metasphere date formats into YYYY-MM-DD
 */
function parseMetaDate(dateStr) {
  if (!dateStr) return null;

  // Try native parse first (handles ISO-like formats)
  const direct = new Date(dateStr);
  if (!isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  // Fallback for MM/DD/YYYY or similar "MM/DD/YYYY HH:mm:ss"
  const firstPart = String(dateStr).split(' ')[0];
  const parts = firstPart.split('/');
  if (parts.length === 3) {
    const [mm, dd, yyyy] = parts.map(p => parseInt(p, 10));
    if (!isNaN(mm) && !isNaN(dd) && !isNaN(yyyy)) {
      const d = new Date(yyyy, mm - 1, dd);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

/**
 * Utility: Normalize GetPrivateStayBookings response
 * into { upcoming, past, cancellations, missing }
 */
function normalizeStayBookings(metaData = {}) {
  const now = new Date();

  const pastRaw = Array.isArray(metaData.PastStaysData) ? metaData.PastStaysData : [];
  const upcomingRaw = Array.isArray(metaData.ReservationData) ? metaData.ReservationData : [];
  const cancellationsRaw = Array.isArray(metaData.CancellationsData) ? metaData.CancellationsData : [];
  const missingRaw = Array.isArray(metaData.MissingStaysData) ? metaData.MissingStaysData : [];

  const past = pastRaw.map((s) => {
    const arrival = parseMetaDate(s.arrivaldate);
    const departure = parseMetaDate(s.departuredate);
    return {
      type: 'stay',
      status: 'completed',
      confirmationNumber: s.confirmationnumber || null,
      hotelName: s.stayhotelname || '',
      arrivalDate: arrival,
      departureDate: departure,
      pointsEarned:
        s.numberofpointsearned != null
          ? Number(s.numberofpointsearned)
          : (s.numberofmypointsforstay != null
              ? Number(s.numberofmypointsforstay)
              : null),
      raw: s
    };
  });

  const upcoming = upcomingRaw.map((s) => {
    const arrival = parseMetaDate(s.arrivaldate);
    const departure = parseMetaDate(s.departuredate);
    const arrivalDateObj = arrival ? new Date(arrival) : null;

    return {
      type: 'booking',
      status: arrivalDateObj && arrivalDateObj < now ? 'in-progress' : 'upcoming',
      confirmationNumber: s.confirmationnumber || null,
      hotelName: s.stayhotelname || '',
      arrivalDate: arrival,
      departureDate: departure,
      pointsForStay:
        s.numberofmypointsforstay != null
          ? Number(s.numberofmypointsforstay)
          : null,
      raw: s
    };
  });

  const cancellations = cancellationsRaw.map((c) => ({
    type: 'cancellation',
    status: 'cancelled',
    confirmationNumber: c.confirmationnumber || null,
    hotelName: c.stayhotelname || '',
    arrivalDate: parseMetaDate(c.arrivaldate),
    departureDate: parseMetaDate(c.departuredate),
    raw: c
  }));

  const missing = missingRaw.map((m) => ({
    type: 'missing',
    status: 'missing',
    hotelName: m.stayhotelname || '',
    arrivalDate: parseMetaDate(m.arrivaldate),
    departureDate: parseMetaDate(m.departuredate),
    raw: m
  }));

  // Sort upcoming by arrival ascending, past by arrival descending
  upcoming.sort((a, b) => new Date(a.arrivalDate || 0) - new Date(b.arrivalDate || 0));
  past.sort((a, b) => new Date(b.arrivalDate || 0) - new Date(a.arrivalDate || 0));

  return { upcoming, past, cancellations, missing };
}

// GET user profile
router.post('/profile', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    const token = await getToken();
    if (!token) {
      return res.status(500).json({ success: false, message: 'Could not retrieve access token' });
    }

    const response = await axios.post(
      apiBaseUrl + 'GetPrivateProfile',
      qs.stringify({ email, token }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent
      }
    );

    const data = response.data;

    if (data.flag === '0') {
      res.json({ success: true, message: 'Profile retrieved successfully', profile: data });
    } else {
      res.status(400).json({
        success: false,
        message: data.message || 'Failed to fetch profile',
        raw: data
      });
    }

  } catch (err) {
    console.error('Profile fetch error:', err.message);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// GET user points
router.post('/points/history', async (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ success: false, message: 'Missing profileId' });
  }

  try {
    const token = await getToken();
    if (!token) {
      return res.status(500).json({ success: false, message: 'Token fetch failed' });
    }

    // local httpsAgent is redundant but kept to avoid changing behavior
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // 1. Get Total Points Balance
    const balanceRes = await axios.post(
      'https://servicehub.metasphere.global:8966/api/getProfileStatisticsInfo',
      new URLSearchParams({ Meta_pfprofileId: profileId, flag: 0, token }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent
      }
    );

    const totalPoints = balanceRes.data?.result?.TotalPoint || '0';

    // 2. Get Points Transaction History
    const transactionRes = await axios.post(
      'https://servicehub.metasphere.global:8966/api/getPointsTransaction',
      new URLSearchParams({
        Meta_profileId: profileId,
        flag: 0,
        token,
        start: 0,
        length: 100
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent
      }
    );

    const transactions = transactionRes.data?.data || [];

    // 3. Sort by date + compute running balance
    const formatted = transactions
      .map(t => ({
        ...t,
        META_POINTSAMOUNT: Number(t.META_POINTSAMOUNT),
        META_TRANSACTIONDATEORDER: new Date(t.META_TRANSACTIONDATEORDER)
      }))
      .sort((a, b) => new Date(a.META_TRANSACTIONDATEORDER) - new Date(b.META_TRANSACTIONDATEORDER));

    let runningBalance = 0;
    const enriched = formatted.map(entry => {
      runningBalance += entry.META_POINTSAMOUNT;
      return {
        ...entry,
        runningBalance
      };
    });

    // 4. Return to frontend
    res.json({
      success: true,
      totalPoints,
      transactions: enriched.reverse() // latest first
    });

  } catch (err) {
    console.error('Error in /points/history:', err.message);
    res.status(500).json({ success: false, message: 'Error fetching points data' });
  }
});

// POST user dashboard
router.post('/dashboard', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing email' });
  }

  try {
    const token = await getToken();
    if (!token) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve access token' });
    }

    // Get user profile
    const profileRes = await api.post(
      'GetPrivateProfile',
      qs.stringify({ email, token, _: Date.now() })
    );

    console.log('Profile API response:', JSON.stringify(profileRes.data, null, 2));

    const profileData = profileRes.data;
    let profile;

    if (profileData.data && Array.isArray(profileData.data) && profileData.data.length > 0) {
      profile = profileData.data[0];
    } else if (profileData.result) {
      profile = profileData.result;
    } else {
      profile = profileData;
    }

    // Verify the returned email matches the requested email
    if (profile.primaryemail && profile.primaryemail !== email) {
      console.error('EMAIL MISMATCH ERROR:');
      console.error('Requested email:', email);
      console.error('Returned email:', profile.primaryemail);
      return res.status(500).json({
        success: false,
        message: 'Server returned wrong user data. Please try again.'
      });
    }

    if (!profile || !profile.meta_pfprofile_id) {
      return res.status(404).json({ success: false, message: 'Profile or profile ID not found' });
    }

    const profileId = profile.meta_pfprofile_id;

    // Step 2: Get total points balance
    const statsRes = await api.post(
      'getProfileStatisticsInfo',
      qs.stringify({
        Meta_pfprofileId: profileId,
        flag: '0',
        token
      })
    );

    const totalPoints =
      statsRes.data?.result?.totalPointsBalance ||
      statsRes.data?.result?.TotalPoint ||
      0;

    // Step 3: Fetch points transaction history
    const transactionsRes = await api.post(
      'getPointsTransaction',
      qs.stringify({
        Meta_profileId: profileId,
        flag: '0',
        token,
        start: 0,
        length: 100
      })
    );

    const history = transactionsRes.data?.data || [];

    // Final output - INCLUDE EMAIL
    return res.json({
      success: true,
      message: 'Dashboard data retrieved',
      dashboard: {
        email: email,
        name: `${profile.firstname || ''} ${profile.lastname || ''}`.trim(),
        tier: profile.membershiptier || 'Unknown',
        membershipNo: profile.membershipno || '',
        profileId,
        totalPoints,
        membershiptier: profile.membershiptier || 'Unknown',
        history
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Reservations via GetReservation_Mobile (existing route - unchanged)
router.post('/reservations', async (req, res) => {
  const { email, token } = req.body || {};

  console.log('Reservations request body:', req.body);
  console.log('Reservations - email:', email);
  console.log('Reservations - token:', token);

  if (!email || !token) {
    return res.status(400).json({
      success: false,
      message: 'Missing email or token'
    });
  }

  try {
    const reservationRes = await api.get(
      `GetReservation_Mobile?hotelId=HBR&token=${token}&email=${email}`
    );

    const allReservations = reservationRes.data?.data || [];

    const now = new Date();
    const past = [];
    const upcoming = [];

    allReservations.forEach((resv) => {
      const checkinDate = new Date(resv.checkinDate);
      if (checkinDate < now) {
        past.push(resv);
      } else {
        upcoming.push(resv);
      }
    });

    return res.json({
      success: true,
      message: 'Reservations fetched',
      reservations: {
        past,
        upcoming
      }
    });
  } catch (err) {
    console.error('Reservation fetch error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// NEW: Stays & bookings via 3.7 GetPrivateStayBookings
router.post('/stays', async (req, res) => {
  try {
    const { email, membershipNo } = req.body || {};

    if (!email && !membershipNo) {
      return res.status(400).json({
        success: false,
        message: 'Missing email or membershipNo'
      });
    }

    // 1. Get token
    const token = await getToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve access token'
      });
    }

    // 2. Resolve membership number
    let membershipno = membershipNo;

    if (!membershipno && email) {
      const profileRes = await api.post(
        'GetPrivateProfile',
        qs.stringify({ email, token, flag: 0 })
      );

      const profileData = profileRes.data;
      let profile = null;

      if (profileData?.data && Array.isArray(profileData.data) && profileData.data.length > 0) {
        profile = profileData.data[0];
      } else if (profileData?.result && typeof profileData.result === 'object') {
        profile = profileData.result;
      } else if (typeof profileData === 'object') {
        profile = profileData;
      }

      if (!profile || !profile.membershipno) {
        return res.status(404).json({
          success: false,
          message: 'Membership number not found for this user'
        });
      }

      if (profile.primaryemail && email && profile.primaryemail !== email) {
        console.error('GetPrivateStayBookings: email mismatch', {
          requested: email,
          returned: profile.primaryemail
        });
        return res.status(500).json({
          success: false,
          message: 'Profile email mismatch from CRM'
        });
      }

      membershipno = profile.membershipno;
    }

    if (!membershipno) {
      return res.status(400).json({
        success: false,
        message: 'Unable to resolve membership number'
      });
    }

    // 3. Call GetPrivateStayBookings (3.7)
    const stayRes = await axios.post(
      apiBaseUrl + 'GetPrivateStayBookings',
      qs.stringify({
        membershipno,
        flag: 0,
        token
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent
      }
    );

    const data = stayRes.data || {};

    if (data.flag !== '0') {
      console.error('GetPrivateStayBookings error:', data);
      return res.status(502).json({
        success: false,
        message: data.Message || data.result || 'Failed to fetch stays & bookings',
        raw: data
      });
    }

    const normalized = normalizeStayBookings(data);

    return res.json({
      success: true,
      message: 'Stays & bookings retrieved',
      membershipNo: membershipno,
      ...normalized
    });
  } catch (err) {
    console.error('Error in /stays:', err.message, err.response?.data || '');
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching stays & bookings',
      error: err.message
    });
  }
});

module.exports = router;
