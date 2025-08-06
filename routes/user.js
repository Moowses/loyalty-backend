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

    // Step 1: Get user profile to retrieve meta_pfprofile_id
    const profileRes = await api.post(
      'GetPrivateProfile',
      qs.stringify({ email, token })
    );
    console.log('Full profile response:', profileRes.data);

    const profile = profileRes.data?.data?.[0];
    

    if (!profile || !profile.meta_pfprofile_id) {
      return res.status(404).json({ success: false, message: 'Profile or profile ID not found' });
    }

    const profileId = profile.meta_pfprofile_id;
    const fullName = `${profile.firstname} ${profile.lastname}`;
    const membershiptier=profileRes.membershiptier || 'Unknown';
    // Step 2: Get total points balance
    const statsRes = await api.post(
      'getProfileStatisticsInfo',
      qs.stringify({
        Meta_pfprofileId: profileId,
        flag: '0',
        token
      })
    );
    const totalPoints = statsRes.data?.result?.totalPointsBalance ?? 0;

    // Step 3 (Optional): Fetch points transaction history
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
      


    // Final output
    return res.json({
      success: true,
      message: 'Dashboard data retrieved',
      dashboard: {
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

//sign up 

router.post('/signup', async (req, res) => {
  const { firstname, lastname, email, mobilenumber, password } = req.body;

  if (!firstname || !lastname || !email || !mobilenumber || !password) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }

  try {
    const token = await getToken();
    if (!token) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve access token' });
    }

    // Construct query params as required by RegisterMembership endpoint
    const payload = {
      salutation: 'Mr',
      Firstname: firstname,
      Lastname: lastname,
      Emailaddress: email,
      dateofbirth: '08/08/1988',
      Nationality: 'Canadian',
      Membershippwd: password,
      Mailingaddress: 'N/A',
      Postalcode: '0000',
      City: 'N/A',
      State: 'N/A',
      Country: 'Canada',
      Phonenumber: mobilenumber,
      Mobilenumber: mobilenumber,
      Contactpreference: 'email',
      Communicationpreference: '111111',
      Promotioncode: '',
      flag: '0',
      socialMediaType: '1',
      token
    };

    const querystring = qs.stringify(payload);

    const response = await axios.post(
      `${apiBaseUrl}RegisterMembership?${querystring}`,
      null,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent
      }
    );

    const data = response.data;

    if (data.flag === '0') {
      return res.json({ success: true, message: 'Signup successful', result: data });
    } else {
      return res.status(400).json({
        success: false,
        message: data.message || 'Signup failed',
        result: data
      });
    }
  } catch (err) {
    console.error('Signup error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});


//Trasaction

router.post('/reservations', async (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ success: false, message: 'Missing email or token' });
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
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});



module.exports = router;


