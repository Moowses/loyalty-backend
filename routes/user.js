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
      res.status(400).json({ success: false, message: data.message || 'Failed to fetch profile', raw: data });
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
      transactions: enriched.reverse() // return latest first
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

     console.log('Profile API response:', JSON.stringify(profileRes.data, null, 2)); // ADD THIS

    const profileData = profileRes.data;
    let profile;
    
    if (profileData.data && Array.isArray(profileData.data) && profileData.data.length > 0) {
      profile = profileData.data[0];
    } else if (profileData.result) {
      profile = profileData.result;
    } else {
      profile = profileData;
    }

    // CRITICAL: Verify the returned email matches the requested email
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
    
    const totalPoints = statsRes.data?.result?.totalPointsBalance || 
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
        email: email, // ADD THIS LINE
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

// sign up 

//Trasaction

router.post('/reservations', async (req, res) => {
  // FIX: Add proper destructuring with default values
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

    // Filter reservations by date
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
        upcoming,
      },
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



module.exports = router;


