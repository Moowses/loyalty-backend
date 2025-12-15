// routes/surveyRoutes.js
const express = require('express');
const router = express.Router();
const {
  getGuestInfoByProfileId,
  saveProfileSurvey,
} = require('../services/crmSurveyService');

// GET /api/review/guest-info?profileId=xxx&reservationId=yyy
router.get('/guest-info', async (req, res) => {
  try {
    // Support both profileId and ProfileId just in case
    const profileId = req.query.profileId || req.query.ProfileId;
    const reservationId = req.query.reservationId || req.query.reservationID;

    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }
    if (!reservationId) {
      return res.status(400).json({ error: 'reservationId is required' });
    }

    const info = await getGuestInfoByProfileId(profileId, reservationId);

    if (!info) {
      return res
        .status(404)
        .json({ error: 'Guest not found for this profileId/reservationId' });
    }

    res.json({
      guestName: info.guestName,
      listingName: info.listingName,
      email: info.email,
      profileId,
      reservationId,
    });
  } catch (err) {
    console.error('Error in /api/review/guest-info:', err.message, err.crmResponse);
    res.status(500).json({
      error: 'Failed to fetch guest info',
      details: err.crmResponse || err.message,
    });
  }
});

// POST /api/review/submit
// Body supports: profileId/ProfileId, reservationId, rating/Rating, reviewTitle/ReviewTitle, message/Message, email/Email
router.post('/submit', async (req, res) => {
  try {
    const body = req.body || {};

    const profileId = body.profileId || body.ProfileId;
    const reservationId = body.reservationId || body.reservationID;
    const ratingRaw = body.rating ?? body.Rating;
    const reviewTitle = body.reviewTitle || body.ReviewTitle;
    const message = body.message || body.Message;
    const email = body.email || body.Email;

    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }
    if (!reservationId) {
      return res.status(400).json({ error: 'reservationId is required' });
    }
    if (ratingRaw === undefined || ratingRaw === null) {
      return res.status(400).json({ error: 'rating is required' });
    }
    if (!reviewTitle) {
      return res.status(400).json({ error: 'reviewTitle is required' });
    }
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const parsedRating = parseInt(ratingRaw, 10);
    if (Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({
        error: 'rating must be an integer between 1 and 5',
      });
    }

    const result = await saveProfileSurvey({
      profileId,
      reservationId,
      rating: parsedRating,
      reviewTitle,
      message,
      email,
    });

    res.json({
      success: true,
      surveyId: result.surveyId,
      profileId,
      reservationId,
    });
  } catch (err) {
    console.error('Error in /api/review/submit:', err.message, err.crmResponse);
    res.status(500).json({
      error: 'Failed to submit review',
      details: err.crmResponse || err.message,
    });
  }
});

module.exports = router;
