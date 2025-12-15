// services/crmSurveyService.js
const axios = require('axios');

const SURVEY_BASE_URL =
  process.env.CRM_SURVEY_BASE_URL ||
  'http://3.17.182.106:8033/customize/control'; // UAT base

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * CRM: getGuestInfoByProfileId
 * Now requires reservationId (v1.1) Emma update
 * GET .../getGuestInfoByProfileId?profileId=...&reservationId=...
 */
async function getGuestInfoByProfileId(profileId, reservationId) {
  if (!profileId) throw new Error('profileId is required');
  if (!reservationId) throw new Error('reservationId is required');

  const url = `${SURVEY_BASE_URL}/getGuestInfoByProfileId`;

  try {
    const res = await axios.get(url, {
      params: { profileId, reservationId },
      headers: buildHeaders(),
      timeout: 20000,
    });

    const body = res.data;

    if (!body || !Array.isArray(body.data) || body.data.length === 0) {
      return null;
    }

    const guest = body.data[0];

    return {
      guestName: guest.GUESTNAME || '',
      listingName: guest.COTTAGENAME || '',
      email: guest.EMAIL || '',
      raw: body,
    };
  } catch (error) {
    console.error('CRM getGuestInfoByProfileId error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url,
      params: { profileId, reservationId },
    });

    const err = new Error('CRM getGuestInfoByProfileId failed');
    err.crmResponse = error.response?.data || error.message;
    throw err;
  }
}

/**
 * CRM: saveProfileSurvey
 * Now supports reservationId (v1.1) Emma update 
 * POST .../saveProfileSurvey?ProfileId=...&Rating=...&ReviewTitle=...&Message=...&Email=...&reservationId=...
 */
async function saveProfileSurvey({
  profileId,
  reservationId,
  rating,
  reviewTitle,
  message,
  email,
}) {
  if (!profileId) throw new Error('profileId is required');
  if (!reservationId) throw new Error('reservationId is required');
  if (rating === undefined || rating === null) throw new Error('rating is required');
  if (!reviewTitle) throw new Error('reviewTitle is required');
  if (!message) throw new Error('message is required');
  if (!email) throw new Error('email is required');

  const url = `${SURVEY_BASE_URL}/saveProfileSurvey`;

  try {
    const res = await axios.post(
      url,
      {},
      {
        // CRM expects query params even though it's POST
        params: {
          ProfileId: profileId,
          reservationId,
          Rating: rating,
          ReviewTitle: reviewTitle,
          Message: message,
          Email: email,
        },
        headers: buildHeaders(),
        timeout: 20000,
      }
    );

    const body = res.data;

    if (!body) {
      throw new Error('Empty response from CRM saveProfileSurvey');
    }

    if (body.msg !== 'success') {
      const err = new Error('CRM saveProfileSurvey failed');
      err.crmResponse = body;
      throw err;
    }

    return {
      success: true,
      surveyId: body.pkid,
      raw: body,
    };
  } catch (error) {
    console.error('CRM saveProfileSurvey error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url,
      params: { profileId, reservationId, rating, reviewTitle, email },
    });

    const err = new Error('CRM saveProfileSurvey failed');
    err.crmResponse = error.response?.data || error.message;
    throw err;
  }
}

module.exports = {
  getGuestInfoByProfileId,
  saveProfileSurvey,
};
