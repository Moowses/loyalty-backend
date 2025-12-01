const express = require('express');
const axios = require('axios');
const https = require('https');
const { getToken } = require('../services/getToken');

const router = express.Router();

// Base URL (e.g. https://servicehub.metasphere.global:8958/api/ or 8966/api/) 
// return if swining to live process.env.API_BASE_URL
const rawBaseUrl = 'https://servicehub.metasphere.global:8966/api/';
const apiBaseUrl = rawBaseUrl.replace(/\/+$/, '');

// SSL helper for local dev
const httpsAgent =
  process.env.NODE_ENV === 'production'
    ? undefined
    : new https.Agent({ rejectUnauthorized: false });

// --- helpers ---
const toNum = (v) =>
  Number(String(v ?? 0).replace(/[^0-9.-]/g, '')) || 0;

// split long ranges into <= 90-day windows
function splitIntoWindows(startISO, endISO, maxDays = 90) {
  const out = [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');

  let cur = new Date(start);
  while (cur < end) {
    const s = new Date(cur);
    const e = new Date(cur);
    e.setDate(e.getDate() + maxDays);
    if (e > end) e.setTime(end.getTime());

    out.push({
      start: s.toISOString().slice(0, 10),
      end: e.toISOString().slice(0, 10),
    });

    cur = new Date(e);
  }
  return out;
}

/**
 * GET /api/calendar/availability
 *
 * Query params:
 *  - hotelNo (preferred)  e.g. GSL / BGVPA
 *  - hotelId (fallback)   e.g. numeric ID
 *  - startDate (YYYY-MM-DD)
 *  - endDate   (YYYY-MM-DD)
 *
 * Response:
 *  {
 *    success: true,
 *    data: {
 *      hotelId,
 *      currencyCode,
 *      dailyPrices: { 'YYYY-MM-DD': price },
 *      availability: { 'YYYY-MM-DD': 1 | 0 },
 *      days: [{ date, available, price }]
 *    },
 *    range: { startDate, endDate }
 *  }
 *
 * Rule:
 *  - date is clickable only if availability[date] === 1
 *    (isAvailable === "1" AND Status === "available")
 */
router.get('/availability', async (req, res) => {
  try {
    const {
      hotelId: hotelIdRaw,
      hotelNo: hotelNoRaw,
      startDate,
      endDate,
      currency = 'CAD',
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required (YYYY-MM-DD).',
      });
    }

    if (!hotelIdRaw && !hotelNoRaw) {
      return res.status(400).json({
        success: false,
        message: 'hotelId or hotelNo is required.',
      });
    }

    // Meta expects the hotel "code" (GSL, BGVPA, etc.) as hotelId
    const hotelNo = String(hotelNoRaw || '').trim();
    const hotelIdNum = Number(hotelIdRaw || 0) || undefined;
    const idForUpstream = hotelNo || hotelIdNum;

    const CCY = String(currency || 'CAD').toUpperCase();

    const token = await getToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        message: 'Could not retrieve access token',
      });
    }

    const windows = splitIntoWindows(startDate, endDate, 90);

    // date -> aggregated info
    const byDate = {};
    let lastCurrency = CCY;

    for (const win of windows) {
      const params = {
        hotelId: idForUpstream,
        startTime: win.start,
        endTime: win.end,
        token,
      };

      const resp = await axios.post(
        `${apiBaseUrl}/GetRateAndStatus_Moblie`,
        null,
        {
          params,
          httpsAgent,
          timeout: 30000,
        }
      );

      const data = resp?.data;

      if (!data || data.flag !== '0' || data.result !== 'success') {
        console.warn('Meta calendar window error:', win, data || resp?.data);
        continue;
      }

      const rooms = Array.isArray(data.data)
        ? data.data
        : data.data
        ? [data.data]
        : [];

      for (const room of rooms) {
        if (room?.Currency) lastCurrency = room.Currency;

        const details = Array.isArray(room.details) ? room.details : [];

        for (const d of details) {
          const dateStr = String(d.date || d.Date || '').slice(0, 10);
          if (!dateStr) continue;

          const status = String(d.Status || d.status || '').toLowerCase();
          const isAvailRaw =
            d.isAvailable ?? d.available ?? d.Available ?? d.isAvail;
          const isAvailFlag = String(isAvailRaw ?? '').trim();
          const isAvail = isAvailFlag === '1'; // 1 = available, 0 = unavailable
          const price = toNum(d.price || d.Price);

          if (!byDate[dateStr]) {
            byDate[dateStr] = {
              date: dateStr,
              available: false,
              minPrice: null,
            };
          }

          const entry = byDate[dateStr];

          // our rule: only mark available when both:
          //  - isAvailable === "1"
          //  - Status === "available"
          if (isAvail && status === 'available') {
            entry.available = true;
          }

          if (price > 0) {
            if (entry.minPrice == null || price < entry.minPrice) {
              entry.minPrice = price;
            }
          }
        }
      }
    }

    const dailyPrices = {};
    const availability = {};
    const days = [];

    Object.keys(byDate)
      .sort((a, b) => a.localeCompare(b))
      .forEach((dateStr) => {
        const entry = byDate[dateStr];
        const availFlag = entry.available ? 1 : 0;

        availability[dateStr] = availFlag;
        if (entry.minPrice != null) {
          dailyPrices[dateStr] = entry.minPrice;
        }

        days.push({
          date: dateStr,
          available: !!entry.available,
          price: entry.minPrice,
        });
      });

    return res.json({
      success: true,
      data: {
        hotelId: hotelIdRaw || hotelNoRaw,
        currencyCode: lastCurrency || CCY,
        dailyPrices,
        availability, // 1 = clickable, 0 = not clickable
        days,
      },
      range: { startDate, endDate },
    });
  } catch (err) {
    console.error('Calendar API error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message:
        err?.response?.data?.message ||
        err.message ||
        'Failed to fetch calendar availability',
    });
  }
});

module.exports = router;
