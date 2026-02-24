const express = require('express');
const https = require('https');
const { refreshProdToken, PROD_PROVIDER_KEY } = require('../services/getToken');
const { postWithProviderToken } = require('../services/metasphereAuth');

const router = express.Router();

const CALABOGIE_HOTEL_ID = 'CBE';
const META_BASE_URL = 'https://servicehub.metasphere.global:8966/api';
const httpsAgent =
  process.env.NODE_ENV === 'production'
    ? undefined
    : new https.Agent({ rejectUnauthorized: false });

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
  'not available',
]);
const OPEN_STATUSES = new Set(['available', 'open']);

const toNum = (v) => Number(String(v ?? 0).replace(/[^0-9.-]/g, '')) || 0;
const asYesNo = (v, def = 'no') => {
  const s = String(v ?? '').toLowerCase();
  if (s === '1' || s === 'yes' || s === 'true') return 'yes';
  if (s === '0' || s === 'no' || s === 'false') return 'no';
  return def;
};
const toInt = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isNaN(n) ? null : n;
};
const parseInventoryCount = (value) => {
  if (value == null) return 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return 0;
  const asNum = Number(normalized);
  if (Number.isFinite(asNum)) return asNum > 0 ? Math.floor(asNum) : 0;
  if (normalized === 'true' || normalized === 'yes' || normalized === 'available') return 1;
  return 0;
};

const resolveAvailability = (statusRaw, inventoryCount) => {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (status && BLOCKED_STATUSES.has(status)) return false;
  if (status && OPEN_STATUSES.has(status)) return true;
  return inventoryCount > 0;
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
  if (isAvailable) bucket.available = true;
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

const normalizeByDateMap = (byDate, defaults, orderedDates) => {
  const dailyPrices = {};
  const availability = {};
  const minStayMap = {};
  const maxStayMap = {};
  const normalizedDefaults = {
    minNights: defaults?.minNights ?? 1,
    maxNights: defaults?.maxNights ?? 365,
  };

  const sortedDates = Array.isArray(orderedDates) && orderedDates.length
    ? orderedDates
    : Object.keys(byDate).sort((a, b) => a.localeCompare(b));

  for (const dateStr of sortedDates) {
    const entry = byDate[dateStr] || createDateBucket(dateStr);
    const bestPrice = entry.minAvailablePrice ?? entry.minAnyPrice;
    const minStayValue = entry.minStay ?? normalizedDefaults.minNights;
    const maxStayValue = entry.maxStay ?? normalizedDefaults.maxNights;

    availability[dateStr] = entry.available ? 1 : 0;
    if (bestPrice != null) dailyPrices[dateStr] = bestPrice;
    minStayMap[dateStr] = minStayValue;
    maxStayMap[dateStr] = maxStayValue;
  }

  return {
    dailyPrices,
    availability,
    minStay: minStayMap,
    maxStay: maxStayMap,
    defaults: normalizedDefaults,
  };
};

const splitIntoWindows = (startISO, endISO, maxDays = 90) => {
  const out = [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  let cur = new Date(start);

  while (cur < end) {
    const s = new Date(cur);
    const e = new Date(cur);
    e.setUTCDate(e.getUTCDate() + maxDays);
    if (e > end) e.setTime(end.getTime());

    out.push({
      start: s.toISOString().slice(0, 10),
      end: e.toISOString().slice(0, 10),
    });
    cur = new Date(e);
  }
  return out;
};

const parseISODate = (value) => {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const dt = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.toISOString().slice(0, 10) !== raw) return null;
  return dt;
};

const validateDateRangeOr400 = (res, startDate, endDate) => {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);

  if (!startDate || !endDate || !start || !end) {
    res.status(400).json({
      success: false,
      message: 'startDate and endDate are required in YYYY-MM-DD format.',
    });
    return null;
  }
  if (start >= end) {
    res.status(400).json({
      success: false,
      message: 'startDate must be before endDate.',
    });
    return null;
  }
  return { start, end };
};

const fetchStatusRows = async (startDate, endDate) => {
  const windows = splitIntoWindows(startDate, endDate, 90);
  const allRows = [];

  for (const win of windows) {
    const resp = await postWithProviderToken({
      provider: PROD_PROVIDER_KEY,
      refreshFn: refreshProdToken,
      url: `${META_BASE_URL}/GetRateAndStatus_Moblie`,
      body: null,
      params: {
        hotelId: CALABOGIE_HOTEL_ID,
        startTime: win.start,
        endTime: win.end,
      },
      axiosConfig: {
        httpsAgent,
        timeout: 30000,
      },
    });

    const data = resp?.data;
    if (!data || data.result !== 'success' || data.flag !== '0') continue;
    const rows = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
    allRows.push(...rows);
  }

  return allRows;
};

const fetchRateRows = async ({ startDate, endDate, adults, children, infant, pet, currency }) => {
  const resp = await postWithProviderToken({
    provider: PROD_PROVIDER_KEY,
    refreshFn: refreshProdToken,
    url: `${META_BASE_URL}/GetRateAndAvailability_Moblie`,
    body: null,
    params: {
      hotelId: CALABOGIE_HOTEL_ID,
      startDate,
      endDate,
      startTime: startDate,
      endTime: endDate,
      adults,
      children,
      infaut: infant, // upstream key spelling
      pet,
      currency,
    },
    axiosConfig: {
      httpsAgent,
      timeout: 30000,
    },
  });

  const data = resp?.data;
  if (!data || data.result !== 'success' || data.flag !== '0') return [];
  return Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
};

const buildAvailabilityContext = ({ rows, startDate, endDate, currency = 'CAD' }) => {
  const byDate = {};
  const byRoomType = {};
  let lastCurrency = String(currency || 'CAD').toUpperCase();
  let defaultMinNights = null;
  let defaultMaxNights = null;

  for (const room of rows) {
    if (room?.Currency) lastCurrency = room.Currency;
    const rtId = String(room?.RoomTypeId || room?.roomTypeId || '').trim() || 'unknown';
    const rtName = String(room?.RoomTypeName || room?.roomTypeName || '').trim() || null;
    const roomMinNights = toInt(room?.min_Nights ?? room?.minNights);
    const roomMaxNights = toInt(room?.max_Nights ?? room?.maxNights);

    if (!byRoomType[rtId]) {
      byRoomType[rtId] = {
        roomTypeId: rtId,
        roomTypeName: rtName,
        byDate: {},
        defaults: { minNights: null, maxNights: null },
        currencyCode: room?.Currency || null,
      };
    } else if (!byRoomType[rtId].roomTypeName && rtName) {
      byRoomType[rtId].roomTypeName = rtName;
    }
    const roomAgg = byRoomType[rtId];

    if (roomMinNights != null) {
      if (defaultMinNights == null || roomMinNights < defaultMinNights) defaultMinNights = roomMinNights;
      if (roomAgg.defaults.minNights == null || roomMinNights < roomAgg.defaults.minNights) {
        roomAgg.defaults.minNights = roomMinNights;
      }
    }
    if (roomMaxNights != null) {
      if (defaultMaxNights == null || roomMaxNights > defaultMaxNights) defaultMaxNights = roomMaxNights;
      if (roomAgg.defaults.maxNights == null || roomMaxNights > roomAgg.defaults.maxNights) {
        roomAgg.defaults.maxNights = roomMaxNights;
      }
    }

    const details = Array.isArray(room?.details) ? room.details : [];
    for (const d of details) {
      const dateStr = String(d?.date || d?.Date || '').slice(0, 10);
      if (!dateStr) continue;

      const status = String(d?.Status || d?.status || '').toLowerCase();
      const inventoryCount = parseInventoryCount(
        d?.isAvailable ?? d?.available ?? d?.Available ?? d?.isAvail
      );
      const isAvailable = resolveAvailability(status, inventoryCount);
      const price = toNum(d?.price || d?.Price);
      const dayMinStay = toInt(d?.minimum_Stay ?? d?.minimumStay);
      const dayMaxStay = toInt(d?.maximum_Stay ?? d?.maximumStay);

      const effectiveMin = dayMinStay ?? roomMinNights ?? defaultMinNights ?? null;
      const effectiveMax = dayMaxStay ?? roomMaxNights ?? defaultMaxNights ?? null;
      const roomEffectiveMin = dayMinStay ?? roomMinNights ?? roomAgg.defaults.minNights ?? null;
      const roomEffectiveMax = dayMaxStay ?? roomMaxNights ?? roomAgg.defaults.maxNights ?? null;

      if (!byDate[dateStr]) byDate[dateStr] = createDateBucket(dateStr);
      if (!roomAgg.byDate[dateStr]) roomAgg.byDate[dateStr] = createDateBucket(dateStr);

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

  const requestedDates = eachDateStartInclusiveEndExclusive(startDate, endDate);
  const aggregated = normalizeByDateMap(
    byDate,
    { minNights: defaultMinNights, maxNights: defaultMaxNights },
    requestedDates
  );

  const normalizedByRoomType = {};
  const roomTypes = [];
  Object.values(byRoomType).forEach((rt) => {
    normalizedByRoomType[rt.roomTypeId] = {
      roomTypeId: rt.roomTypeId,
      roomTypeName: rt.roomTypeName,
      currencyCode: rt.currencyCode || lastCurrency,
      ...normalizeByDateMap(rt.byDate, rt.defaults, requestedDates),
    };
    roomTypes.push({
      roomTypeId: rt.roomTypeId,
      roomTypeName: rt.roomTypeName,
    });
  });
  roomTypes.sort((a, b) =>
    String(a.roomTypeName || '').localeCompare(String(b.roomTypeName || ''))
  );

  return {
    aggregated,
    normalizedByRoomType,
    roomTypes,
    currencyCode: lastCurrency,
  };
};

router.get('/room-types', async (req, res) => {
  try {
    const today = new Date();
    const startDate = today.toISOString().slice(0, 10);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 30);
    const endDate = end.toISOString().slice(0, 10);

    const rows = await fetchStatusRows(startDate, endDate);
    const map = new Map();
    for (const r of rows) {
      const roomTypeId = String(r?.RoomTypeId || r?.roomTypeId || '').trim();
      if (!roomTypeId) continue;
      if (!map.has(roomTypeId)) {
        map.set(roomTypeId, {
          roomTypeId,
          roomTypeName: String(r?.RoomTypeName || r?.roomTypeName || '').trim() || null,
        });
      }
    }

    const roomTypes = Array.from(map.values()).sort((a, b) =>
      String(a.roomTypeName || '').localeCompare(String(b.roomTypeName || ''))
    );

    return res.json({
      success: true,
      data: {
        hotelId: CALABOGIE_HOTEL_ID,
        roomTypes,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || 'Failed to load Calabogie room types',
    });
  }
});

router.get('/availability', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');

  try {
    const { startDate, endDate, roomTypeId: roomTypeIdRaw, currency = 'CAD' } = req.query;
    const requestedRoomTypeId = String(roomTypeIdRaw || '').trim();
    if (!validateDateRangeOr400(res, startDate, endDate)) return;

    const rows = await fetchStatusRows(startDate, endDate);
    const context = buildAvailabilityContext({ rows, startDate, endDate, currency });

    const selected =
      requestedRoomTypeId && context.normalizedByRoomType[requestedRoomTypeId]
        ? {
            ...context.normalizedByRoomType[requestedRoomTypeId],
            roomTypeId: requestedRoomTypeId,
          }
        : {
            ...context.aggregated,
            currencyCode: context.currencyCode,
            roomTypeId: null,
          };

    return res.json({
      success: true,
      data: {
        hotelId: CALABOGIE_HOTEL_ID,
        hotelNo: CALABOGIE_HOTEL_ID,
        roomTypeId: selected.roomTypeId,
        currencyCode: selected.currencyCode || String(currency || 'CAD').toUpperCase(),
        dailyPrices: selected.dailyPrices,
        availability: selected.availability,
        minStay: selected.minStay,
        maxStay: selected.maxStay,
        defaults: selected.defaults,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || 'Failed to load Calabogie availability',
    });
  }
});

router.get('/search', async (req, res) => {
  try {
    const {
      checkIn,
      checkOut,
      startDate,
      endDate,
      adult,
      child,
      infant,
      pet,
      currency = 'CAD',
    } = req.query;

    const ci = String(checkIn || startDate || '');
    const co = String(checkOut || endDate || '');
    if (!validateDateRangeOr400(res, ci, co)) return;

    const adults = Number(adult ?? 1);
    const children = Number(child ?? 0);
    const infants = Number(infant ?? 0);
    const petValue = asYesNo(pet, 'no');
    const ccy = String(currency || 'CAD').toUpperCase();

    const statusRows = await fetchStatusRows(ci, co);
    const context = buildAvailabilityContext({ rows: statusRows, startDate: ci, endDate: co, currency: ccy });
    const totalFrom = Object.values(context.aggregated.dailyPrices).reduce((sum, v) => sum + toNum(v), 0);
    const availableNights = Object.values(context.aggregated.availability).filter((v) => v === 1).length;

    return res.json({
      success: true,
      data: {
        hotelId: CALABOGIE_HOTEL_ID,
        hotelNo: CALABOGIE_HOTEL_ID,
        checkIn: ci,
        checkOut: co,
        guests: {
          adult: adults,
          child: children,
          infant: infants,
          pet: petValue,
        },
        currencyCode: ccy,
        roomTypeCount: context.roomTypes.length,
        availableNights,
        baseQualifiedRate: {
          totalPrice: totalFrom,
          nightlyCount: Object.keys(context.aggregated.dailyPrices).length,
          dailyPrices: context.aggregated.dailyPrices,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || 'Failed to load Calabogie search discovery',
    });
  }
});

router.get('/results', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');

  try {
    const { startDate, endDate, adult, child, infant, pet, currency = 'CAD' } = req.query;
    if (!validateDateRangeOr400(res, startDate, endDate)) return;

    const adults = Number(adult ?? 1);
    const children = Number(child ?? 0);
    const infants = Number(infant ?? 0);
    const petValue = asYesNo(pet, 'no');
    const ccy = String(currency || 'CAD').toUpperCase();

    const statusRows = await fetchStatusRows(startDate, endDate);
    const context = buildAvailabilityContext({
      rows: statusRows,
      startDate,
      endDate,
      currency: ccy,
    });

    const rows = context.roomTypes.map((rt) => {
      const normalized = context.normalizedByRoomType[rt.roomTypeId] || {
        dailyPrices: {},
        availability: {},
        minStay: {},
        maxStay: {},
        defaults: { minNights: 1, maxNights: 365 },
      };
      const totalPrice = Object.values(normalized.dailyPrices).reduce((sum, v) => sum + toNum(v), 0);
      return {
        hotelId: CALABOGIE_HOTEL_ID,
        hotelNo: CALABOGIE_HOTEL_ID,
        roomTypeId: rt.roomTypeId,
        roomTypeName: rt.roomTypeName,
        currencyCode: normalized.currencyCode || ccy,
        dailyPrices: normalized.dailyPrices,
        availability: normalized.availability,
        minStay: normalized.minStay,
        maxStay: normalized.maxStay,
        defaults: normalized.defaults,
        totalPrice,
      };
    });

    return res.json({
      success: true,
      data: {
        hotelId: CALABOGIE_HOTEL_ID,
        hotelNo: CALABOGIE_HOTEL_ID,
        startDate,
        endDate,
        guests: {
          adult: adults,
          child: children,
          infant: infants,
          pet: petValue,
        },
        currencyCode: ccy,
        rows,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || 'Failed to load Calabogie results',
    });
  }
});

router.get('/view-all-rooms', async (_req, res) => {
  try {
    const today = new Date();
    const startDate = today.toISOString().slice(0, 10);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 30);
    const endDate = end.toISOString().slice(0, 10);

    const rows = await fetchStatusRows(startDate, endDate);
    const map = new Map();
    for (const r of rows) {
      const roomTypeId = String(r?.RoomTypeId || r?.roomTypeId || '').trim();
      if (!roomTypeId) continue;
      if (!map.has(roomTypeId)) {
        map.set(roomTypeId, {
          roomTypeId,
          roomTypeName: String(r?.RoomTypeName || r?.roomTypeName || '').trim() || null,
        });
      }
    }

    const roomTypes = Array.from(map.values()).sort((a, b) =>
      String(a.roomTypeName || '').localeCompare(String(b.roomTypeName || ''))
    );

    return res.json({
      success: true,
      data: {
        hotelId: CALABOGIE_HOTEL_ID,
        hotelNo: CALABOGIE_HOTEL_ID,
        roomTypes,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || 'Failed to load Calabogie rooms',
    });
  }
});

router.get('/quote', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      roomTypeId: roomTypeIdRaw,
      adult,
      child,
      infant,
      pet,
      currency = 'CAD',
    } = req.query;

    if (!validateDateRangeOr400(res, startDate, endDate)) return;

    const roomTypeId = String(roomTypeIdRaw || '').trim();
    if (!roomTypeId) {
      return res.status(400).json({
        success: false,
        message: 'roomTypeId is required for Calabogie quote.',
      });
    }

    const adults = Number(adult ?? 1);
    const children = Number(child ?? 0);
    const infants = Number(infant ?? 0);
    const petValue = asYesNo(pet, 'no');
    const ccy = String(currency || 'CAD').toUpperCase();

    const rateRows = await fetchRateRows({
      startDate,
      endDate,
      adults,
      children,
      infant: infants,
      pet: petValue,
      currency: ccy,
    });

    const row = rateRows.find((r) => String(r?.RoomTypeId || r?.roomTypeId || '').trim() === roomTypeId);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: `roomTypeId '${roomTypeId}' was not found for hotel '${CALABOGIE_HOTEL_ID}'.`,
      });
    }

    const dailyPrices = {};
    const details = Array.isArray(row?.details) ? row.details : [];
    for (const d of details) {
      const dateStr = String(d?.date || d?.Date || '').slice(0, 10);
      if (!dateStr) continue;
      dailyPrices[dateStr] = toNum(d?.price || d?.Price);
    }

    const roomSubtotal = Object.values(dailyPrices).reduce((sum, v) => sum + toNum(v), 0) || toNum(row?.totalPrice);
    const petFeeAmount = toNum(row?.petFeeAmount);
    const cleaningFeeAmount = toNum(row?.cleaningFee ?? row?.CleaningFee);
    const vatAmount = toNum(row?.Vat ?? row?.VAT ?? row?.vat);
    const grossAmountUpstream = toNum(row?.GrossAmount || row?.grossAmount);

    return res.json({
      success: true,
      data: {
        hotelId: CALABOGIE_HOTEL_ID,
        hotelNo: CALABOGIE_HOTEL_ID,
        roomTypeId,
        roomTypeName: String(row?.RoomTypeName || row?.roomTypeName || '').trim() || null,
        startDate,
        endDate,
        adults,
        children,
        infant: infants,
        pet: petValue,
        currencyCode: ccy,
        dailyPrices,
        roomSubtotal,
        petFeeAmount,
        cleaningFeeAmount,
        vatAmount,
        grossAmountUpstream,
        bookingIdentifiers: {
          hotelId: CALABOGIE_HOTEL_ID,
          hotelNo: CALABOGIE_HOTEL_ID,
          roomTypeId,
          startDate,
          endDate,
          adults,
          children,
          infant: infants,
          pet: petValue,
          currency: ccy,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || 'Failed to load Calabogie quote',
    });
  }
});

router.get('/meta', async (_req, res) => {
  return res.json({
    success: true,
    data: {
      hotelId: CALABOGIE_HOTEL_ID,
      name: 'Calabogie Escapes',
      address: '504 Barrett Chute Road, Calabogie, ON K0J 1H0, Canada',
      description:
        'Calabogie Escapes offers resort-style mountain and lakeside accommodations near Calabogie Peaks, with year-round outdoor activities and family-friendly stays.',
      images: [],
      coordinates: { lat: 45.294288, lng: -76.7453235 },
    },
  });
});

module.exports = router;
