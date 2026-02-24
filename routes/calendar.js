const express = require('express');
const axios = require('axios');
const https = require('https');
const { withProdTokenRetry } = require('../services/getToken');

const router = express.Router();

// Base URL (e.g. https://servicehub.metasphere.global:8958/api/ or 8966/api/)
// For live, you can later swap this to process.env.API_BASE_URL.
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

const toInt = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isNaN(n) ? null : n;
};

// Meta has multiple availability formats depending on integration version.
// Normalize inventory as:
// - positive integer => available inventory count
// - "true"/"yes"/"available" => 1
// - everything else => 0
const parseInventoryCount = (value) => {
  if (value == null) return 0;

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return 0;

  const asNum = Number(normalized);
  if (Number.isFinite(asNum)) return asNum > 0 ? Math.floor(asNum) : 0;

  if (normalized === 'true' || normalized === 'yes' || normalized === 'available') {
    return 1;
  }

  return 0;
};

const BLOCKED_STATUSES = new Set([
  'reserved',
  'unavailable',
  'blocked',
  'booked',
  'closed',
  'close',
  'blackout',
  'soldout',
  'sold_out',
]);

const OPEN_STATUSES = new Set(['available', 'open']);

const resolveAvailability = (statusRaw, inventoryCount) => {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (status && BLOCKED_STATUSES.has(status)) return false;
  if (status && OPEN_STATUSES.has(status)) return true;
  return inventoryCount > 0;
};

const eachDateStartInclusiveEndExclusive = (startISO, endISO) => {
  const dates = [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  const cur = new Date(start);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
};

const createDateBucket = (dateStr) => ({
  date: dateStr,
  available: false,
  inventory: 0,
  minAvailablePrice: null,
  minAnyPrice: null,
  minStay: null,
  maxStay: null,
});

const mergeIntoDateBucket = (bucket, { isAvailable, inventoryCount, price, effectiveMin, effectiveMax }) => {
  if (isAvailable) {
    bucket.available = true;
  }
  bucket.inventory += inventoryCount;

  if (price > 0) {
    if (bucket.minAnyPrice == null || price < bucket.minAnyPrice) {
      bucket.minAnyPrice = price;
    }
    if (isAvailable) {
      if (bucket.minAvailablePrice == null || price < bucket.minAvailablePrice) {
        bucket.minAvailablePrice = price;
      }
    }
  }

  if (effectiveMin != null) {
    if (bucket.minStay == null || effectiveMin < bucket.minStay) {
      bucket.minStay = effectiveMin;
    }
  }
  if (effectiveMax != null) {
    if (bucket.maxStay == null || effectiveMax > bucket.maxStay) {
      bucket.maxStay = effectiveMax;
    }
  }
};

const normalizeByDateMap = (byDate, defaults, orderedDates = null) => {
  const dailyPrices = {};
  const availability = {};
  const days = {};
  const minStayMap = {};
  const maxStayMap = {};
  const normalizedDefaults = {
    minNights: defaults?.minNights ?? 1,
    maxNights: defaults?.maxNights ?? 365,
  };

  const sortedDates = orderedDates && orderedDates.length
    ? orderedDates
    : Object.keys(byDate).sort((a, b) => a.localeCompare(b));

  sortedDates.forEach((dateStr) => {
      const entry = byDate[dateStr] || createDateBucket(dateStr);
      const availFlag = entry.available ? 1 : 0;
      const bestPrice = entry.minAvailablePrice ?? entry.minAnyPrice;
      const minStayValue = entry.minStay ?? normalizedDefaults.minNights;
      const maxStayValue = entry.maxStay ?? normalizedDefaults.maxNights;

      availability[dateStr] = availFlag;
      if (bestPrice != null) {
        dailyPrices[dateStr] = bestPrice;
      }
      minStayMap[dateStr] = minStayValue;
      maxStayMap[dateStr] = maxStayValue;

      days[dateStr] = {
        date: dateStr,
        available: !!entry.available,
        inventory: entry.inventory,
        price: bestPrice,
        minStay: minStayValue,
        maxStay: maxStayValue,
      };
    });

  return {
    dailyPrices,
    availability,
    days,
    minStay: minStayMap,
    maxStay: maxStayMap,
    defaults: normalizedDefaults,
  };
};

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
 *      availability: { 'YYYY-MM-DD': 1 | 0 }, // 1 = clickable, 0 = not clickable
 *      days: [{ date, available, price, minStay, maxStay }],
 *      minStay: { 'YYYY-MM-DD': number },     // per-day minimum nights
 *      maxStay: { 'YYYY-MM-DD': number },     // per-day maximum nights
 *      defaults: {
 *        minNights, // fallback from room.min_Nights (e.g. 7 nights)
 *        maxNights, // fallback from room.max_Nights
 *      }
 *    },
 *    range: { startDate, endDate }
 *  }
 *
 * Rule:
 *  - date is clickable only if availability[date] === 1
 *    (at least one room type has inventory for that day)
 */
router.get('/availability', async (req, res) => {
  try {
    const {
      hotelId: hotelIdRaw,
      hotelNo: hotelNoRaw,
      roomTypeId: roomTypeIdRaw,
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

    // Strict validation when both identifiers are provided.
    const hotelNo = String(hotelNoRaw || '').trim();
    const hotelId = String(hotelIdRaw || '').trim();
    if (hotelNo && hotelId && hotelNo !== hotelId) {
      return res.status(400).json({
        success: false,
        message: 'hotelNo and hotelId mismatch. Provide one hotel identifier or matching values.',
      });
    }

    // Meta expects hotel identifier in the hotelId param (code or numeric string).
    const requestedHotelId = hotelNo || hotelId;
    const idForUpstream = requestedHotelId;

    const CCY = String(currency || 'CAD').toUpperCase();

    const windows = splitIntoWindows(startDate, endDate, 90);

    // date -> aggregated info across all room types
    const byDate = {};
    // roomTypeId -> room-specific aggregate
    const byRoomType = {};
    let lastCurrency = CCY;

    // overall default min/max nights from the room-level config
    // (e.g. 7 nights fallback when marketing doesn’t configure per-day)
    let defaultMinNights = null;
    let defaultMaxNights = null;

    await withProdTokenRetry(async (token) => {
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

          const roomTypeId = String(room.RoomTypeId || room.roomTypeId || '').trim() || 'unknown';
          const roomTypeName = String(room.RoomTypeName || room.roomTypeName || '').trim() || null;

          if (!byRoomType[roomTypeId]) {
            byRoomType[roomTypeId] = {
              roomTypeId,
              roomTypeName,
              currencyCode: room?.Currency || null,
              byDate: {},
              defaults: {
                minNights: null,
                maxNights: null,
              },
            };
          }

          const roomAgg = byRoomType[roomTypeId];
          if (!roomAgg.roomTypeName && roomTypeName) roomAgg.roomTypeName = roomTypeName;
          if (!roomAgg.currencyCode && room?.Currency) roomAgg.currencyCode = room.Currency;

        // room-level default min/max nights (fallback when day doesn’t have its own rule)
        const roomMinNights = toInt(room.min_Nights ?? room.minNights);
        const roomMaxNights = toInt(room.max_Nights ?? room.maxNights);

          if (roomMinNights != null) {
            if (defaultMinNights == null || roomMinNights < defaultMinNights) {
              defaultMinNights = roomMinNights;
            }
            if (
              roomAgg.defaults.minNights == null ||
              roomMinNights < roomAgg.defaults.minNights
            ) {
              roomAgg.defaults.minNights = roomMinNights;
            }
          }
          if (roomMaxNights != null) {
            if (defaultMaxNights == null || roomMaxNights > defaultMaxNights) {
              defaultMaxNights = roomMaxNights;
            }
            if (
              roomAgg.defaults.maxNights == null ||
              roomMaxNights > roomAgg.defaults.maxNights
            ) {
              roomAgg.defaults.maxNights = roomMaxNights;
            }
          }

        const details = Array.isArray(room.details) ? room.details : [];

        for (const d of details) {
          const dateStr = String(d.date || d.Date || '').slice(0, 10);
          if (!dateStr) continue;

          const status = String(d.Status || d.status || '').toLowerCase();
          const isAvailRaw =
            d.isAvailable ?? d.available ?? d.Available ?? d.isAvail;
          const inventoryCount = parseInventoryCount(isAvailRaw);
          const isAvailable = resolveAvailability(status, inventoryCount);
          const price = toNum(d.price || d.Price);

          // per-day min/max rules from Meta (Hostaway mapping)
          const dayMinStay = toInt(d.minimum_Stay ?? d.minimumStay);
          const dayMaxStay = toInt(d.maximum_Stay ?? d.maximumStay);

          // effective min/max nights for this specific date from this rate
          const effectiveMin =
            dayMinStay ?? roomMinNights ?? defaultMinNights ?? null;
          const effectiveMax =
            dayMaxStay ?? roomMaxNights ?? defaultMaxNights ?? null;
          const roomEffectiveMin =
            dayMinStay ?? roomMinNights ?? roomAgg.defaults.minNights ?? null;
          const roomEffectiveMax =
            dayMaxStay ?? roomMaxNights ?? roomAgg.defaults.maxNights ?? null;

          if (!byDate[dateStr]) {
            byDate[dateStr] = createDateBucket(dateStr);
          }
          if (!roomAgg.byDate[dateStr]) {
            roomAgg.byDate[dateStr] = createDateBucket(dateStr);
          }

          mergeIntoDateBucket(byDate[dateStr], {
            isAvailable,
            inventoryCount,
            price,
            effectiveMin,
            effectiveMax,
          });
          mergeIntoDateBucket(roomAgg.byDate[dateStr], {
            isAvailable,
            inventoryCount,
            price,
            effectiveMin: roomEffectiveMin,
            effectiveMax: roomEffectiveMax,
          });
        }
        }
      }

      return { data: { flag: '0', result: 'success' } };
    });

    const requestedDates = eachDateStartInclusiveEndExclusive(startDate, endDate);

    const normalizedAllRooms = normalizeByDateMap(byDate, {
      minNights: defaultMinNights,
      maxNights: defaultMaxNights,
    }, requestedDates);
    const normalizedByRoomType = {};
    const roomTypes = [];

    Object.keys(byRoomType).forEach((id) => {
      const rt = byRoomType[id];
      normalizedByRoomType[id] = {
        roomTypeId: rt.roomTypeId,
        roomTypeName: rt.roomTypeName,
        currencyCode: rt.currencyCode || lastCurrency || CCY,
        ...normalizeByDateMap(rt.byDate, {
          minNights: rt.defaults.minNights,
          maxNights: rt.defaults.maxNights,
        }, requestedDates),
      };
      roomTypes.push({
        roomTypeId: rt.roomTypeId,
        roomTypeName: rt.roomTypeName,
      });
    });

    const requestedRoomTypeId = String(roomTypeIdRaw || '').trim();

    let selectedRoomTypeId = null;
    if (requestedRoomTypeId && normalizedByRoomType[requestedRoomTypeId]) {
      selectedRoomTypeId = requestedRoomTypeId;
    }

    const selected = selectedRoomTypeId
      ? normalizedByRoomType[selectedRoomTypeId]
      : normalizedAllRooms;

    const baseData = {
      hotelId: requestedHotelId,
      roomTypeId: selectedRoomTypeId || null,
      currencyCode: selected.currencyCode || lastCurrency || CCY,
      dailyPrices: selected.dailyPrices,
      availability: selected.availability, // 1 = clickable, 0 = not clickable
      days: selected.days,
      minStay: selected.minStay,
      maxStay: selected.maxStay,
      defaults: selected.defaults,
    };

    // When roomTypeId is requested, always return the compact room-level shape.
    // If roomTypeId is not found, selected maps are hotel-aggregated fallback.
    if (requestedRoomTypeId) {
      return res.json({
        success: true,
        data: baseData,
        range: { startDate, endDate },
      });
    }

    return res.json({
      success: true,
      data: {
        ...baseData,
        roomTypes,
        byRoomType: normalizedByRoomType,
        aggregated: normalizedAllRooms,
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
