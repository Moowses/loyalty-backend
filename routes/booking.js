const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const { withProdTokenRetry } = require('../services/getToken');

const apiBaseUrl = process.env.API_BASE_URL;
const httpsAgent =  process.env.NODE_ENV === 'production'
   ? undefined
   : new https.Agent({ rejectUnauthorized: false });

// helpers
const toNum = (v) => Number(String(v ?? 0).replace(/[^0-9.-]/g, '')) || 0;
const asYesNo = (v, def = 'no') => {
  const s = String(v ?? '').toLowerCase();
  if (s === '1' || s === 'yes' || s === 'true') return 'yes';
  if (s === '0' || s === 'no'  || s === 'false') return 'no';
  return def;
};

const parseInventoryCount = (value) => {
  const n = Number(String(value ?? '').trim());
  if (Number.isFinite(n)) return n > 0 ? Math.floor(n) : 0;
  return 0;
};

const isRowAvailable = (row) => {
  const status = String(row?.Status || row?.status || '').trim().toLowerCase();
  const isAvailRaw = row?.isAvailable ?? row?.isavailable ?? row?.Available ?? row?.available;
  const inventory = parseInventoryCount(isAvailRaw);

  if (status === 'not available' || status === 'reserved' || status === 'blocked') {
    return false;
  }
  if (status === 'available') return true;

  return inventory > 0;
};

// --- NO-ROOMS detectors ---
const isNoRoomsStub = (it) => {
  const rt = String(it?.RoomType ?? '').toLowerCase();
  const total = Number(String(it?.totalPrice ?? '0').replace(/[^0-9.-]/g,''));
  return rt.includes('no available') || total <= 0;
};

const arrayIsNoRooms = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(isNoRoomsStub);

const messageIsNoRooms = (dataLike) => {
  const flag = String(dataLike?.flag ?? dataLike?.Flag ?? '').toLowerCase();
  const msg  = String(dataLike?.message ?? dataLike?.Message ?? dataLike?.data ?? '').toLowerCase();
  return flag === '0' && /no\s*available/.test(msg);
};

const NO_ROOMS_PAYLOAD = () => ({
  success: true,
  data: { result: 'succ', flag: '0', data: 'No available rooms' },
});

router.get('/availability', async (req, res) => {
  const {
    hotelId: hotelIdRaw,
    hotelNo: hotelNoRaw,
    roomTypeId: roomTypeIdRaw,
    startDate, endDate, startTime, endTime,
    lng, lat,
    adult, adults,
    child, children,
    infant,
    pet,
    currency,
  } = req.query;

  const ci = startDate || startTime;
  const co = endDate   || endTime;
  if (!ci || !co) {
    return res.status(400).json({
      success: false,
      message: 'Missing required dates (startDate/startTime and endDate/endTime).'
    });
  }

  const A   = Number(adults ?? adult ?? 1);
  const C   = Number(children ?? child ?? 0);
  const I   = Number(infant ?? 0);
  const PET = asYesNo(pet, 'no');
  const CCY = String(currency || 'CAD').toUpperCase();

  // Normalized identifiers
  const hotelIdNum = (hotelIdRaw ?? '').toString().trim();  // e.g. "276301"
  const hotelNo    = (hotelNoRaw ?? '').toString().trim();  // e.g. "YDG"
  const requestedRoomTypeId = (roomTypeIdRaw ?? '').toString().trim();
  const hasSingle  = !!hotelIdNum || !!hotelNo;

  try {
    // ---------- SINGLE HOTEL (final pricing) ----------
    if (hasSingle) {
      // 1) Prefer the code if we have it (works reliably with upstream)
      const up = await withProdTokenRetry(async (token) => {
        const tryOnce = async (idForUpstream) => {
          const params = {
            token,
            hotelId: idForUpstream,      // upstream param name is hotelId, but it wants the CODE
            startDate: ci,
            endDate: co,
            startTime: ci,
            endTime: co,
            adults: A,
            children: C,
            infaut: I,                   // keep their odd spelling
            pet: PET,
            currency: CCY,
          };
          return axios.post(
            apiBaseUrl + 'GetRateAndAvailability_Moblie',
            null,
            { params, httpsAgent }
          );
        };

        let up = await tryOnce(hotelNo || hotelIdNum);

        const arr1 = Array.isArray(up?.data?.data)
          ? up.data.data
          : (up?.data?.data ? [up.data.data] : []);
        if ((!arr1 || arr1.length === 0) && !hotelNo && hotelIdNum) {
          // nothing we can do here without a code
        } else if ((!arr1 || arr1.length === 0) && hotelNo && hotelIdNum && hotelNo !== hotelIdNum) {
          up = await tryOnce(hotelNo);
        }

        return up;
      });

      const data = up?.data;
      const arr  = Array.isArray(data?.data)
        ? data.data
        : (data?.data ? [data.data] : []);
      let out;

      // helper to build nightly map from details, if necessary
      const buildDailyFromDetails = (details) => {
        const map = {};
        if (Array.isArray(details)) {
          for (const d of details) {
            const dt = String(d.date || d.Date || '').slice(0, 10);
            const p  = toNum(d.price || d.Price);
            if (dt) map[dt] = p;
          }
        }
        return map;
      };

      if (arr.length) {
        const requestedMatch = requestedRoomTypeId
          ? arr.find((r) => String(r?.RoomTypeId || r?.roomTypeId || '').trim() === requestedRoomTypeId)
          : null;
        const forceRequestedQuote = !!requestedRoomTypeId && !!requestedMatch;

        let first = requestedMatch || null;
        if (!first) {
          const availableRows = arr.filter(isRowAvailable);
          const candidates = availableRows.length ? availableRows : arr;
          first = [...candidates].sort(
            (a, b) => toNum(a?.GrossAmount || a?.totalPrice) - toNum(b?.GrossAmount || b?.totalPrice)
          )[0];
        }

        if (!isRowAvailable(first) && !forceRequestedQuote) {
          // Not bookable -> return "No available rooms"
          out = { result: 'succ', flag: '0', data: 'No available rooms' };
        } else {
          // nightly sum (existing logic)
          let dailyPrices = first?.dailyPrices && typeof first.dailyPrices === 'object'
            ? Object.fromEntries(
                Object.entries(first.dailyPrices).map(([k, v]) => [k, toNum(v)])
              )
            : buildDailyFromDetails(first?.details);

          let roomSubtotal = Object.values(dailyPrices).reduce(
            (a, b) => a + toNum(b),
            0
          );
          if (roomSubtotal <= 0) roomSubtotal = toNum(first?.totalPrice);

          // fees & taxes (existing logic)
          const petFeeAmount       = toNum(first?.petFeeAmount);
          const cleaningFeeAmount  = toNum(first?.cleaningFee ?? first?.CleaningFee);
          const vatAmount          = toNum(first?.Vat ?? first?.VAT ?? first?.vat);
          const grossAmountUpstream= toNum(first?.GrossAmount || first?.grossAmount);

          const grandTotal = roomSubtotal + petFeeAmount + cleaningFeeAmount + vatAmount;

          out = {
            result: 'succ',
            flag: '0',
            data: [{
              hotelNo: first?.hotelNo ?? hotelNo ?? '',
              RoomType: first?.RoomTypeName ?? first?.roomTypeName ?? '',
              lng: first?.lng ?? '',
              dailyPrices,
              roomSubtotal,
              petFeeAmount,
              cleaningFeeAmount,
              vatAmount,
              grandTotal,
              grossAmountUpstream,
              hotelId: hotelNo || hotelIdNum || '',
              hotelName: first?.hotelName ?? '',
              currencyCode: (first?.currencyCode || CCY).toUpperCase(),
              lat: first?.lat ?? '',
              roomTypeId: String(first?.RoomTypeId || first?.roomTypeId || ''),
              requestedRoomTypeId: requestedRoomTypeId || null,
              roomTypeFallback:
                !!requestedRoomTypeId &&
                String(first?.RoomTypeId || first?.roomTypeId || '') !== requestedRoomTypeId,
              status: String(first?.Status || first?.status || ''),
              isAvailable: String(first?.isAvailable || first?.isavailable || ''),
              bookable: isRowAvailable(first),
              capacity: first?.Capacity ?? first?.capacity,
            }],
          };
        }
      } else {
        out = { result: 'succ', flag: '0', data: 'No available rooms' };
      }

      return res.json({ success: true, data: out });
    }

    // NEARBY LIST (search results) 
    if (lng && lat) {
      const response = await withProdTokenRetry(async (token) => {
        const form = qs.stringify({
          startDate: ci, endDate: co, lng, lat,
          adult: A, child: C, infant: I, pet: PET,
          flag: 0, token,
        });
        return axios.post(
          apiBaseUrl + 'getHotelRoomInfo',
          form,
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            httpsAgent
          }
        );
      });

      // normalize new fee/tax fields if present
      const d = response.data;
      if (Array.isArray(d?.data)) {
        for (const item of d.data) {
          item.petFeeAmount      = toNum(item?.petFeeAmount);
          item.cleaningFeeAmount = toNum(item?.cleaningFee ?? item?.CleaningFee);
          item.vatAmount         = toNum(item?.Vat ?? item?.VAT ?? item?.vat);
          if (item?.dailyPrices && typeof item.dailyPrices === 'object') {
            const subtotal = Object.values(item.dailyPrices).reduce(
              (a, b) => a + toNum(b),
              0
            );
            item.totalPrice = String(subtotal);
          }
        }
      }

      return res.json({ success: true, data: d });
    }

    return res.status(400).json({
      success: false,
      message: 'Missing required parameters: either hotelId OR lat/lng.'
    });
  } catch (err) {
    console.error('Availability API error:', err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch availability',
      error: err.response?.data || err.message,
    });
  }
});



//POST /api/booking/confirm payament + create reservation


function friendlyNmiMessage(nmi = {}) {
  const text = String(nmi.resptext || nmi.responsetext || nmi.message || '').toLowerCase();
  const code = String(nmi.respcode || nmi.response_code || '').toLowerCase();
  const avs  = String(nmi.avsresponse || '').toUpperCase();
  const cvv  = String(nmi.cvvresponse || nmi.cvverror || '').toUpperCase();

  // Highest-signal reasons first
  if (cvv && /N|P|S|U/.test(cvv)) {
    return 'The security code (CVV) did not match. Please re-enter and try again.';
  }
  if (avs && /(N|C|I|P|S|U|R)/.test(avs)) {
    return 'The billing address did not match the card on file. Please check your address and postal/ZIP code.';
  }
  if (text.includes('insufficient') || code === '51') {
    return 'Insufficient funds. Please try another card or contact your bank.';
  }
  if (text.includes('do not honor') || code === '05') {
    return 'Your bank declined the charge (Do Not Honor). Please try a different card or call your bank.';
  }
  if (text.includes('pick up') || code === '04') {
    return 'This card was declined by the issuer. Please use a different card.';
  }
  // Fallback to gateway message (capitalized)
  return (nmi.resptext || nmi.responsetext || nmi.message || 'Payment declined');
}

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
        orderid: `BK-${Date.now()}`,

        // NEW (helps AVS/fraud scoring)
        email: String(guest.email || ''),
        billing_firstname: String(guest.firstName || ''),
        billing_lastname: String(guest.lastName || ''),
        billing_address1: String(guest.address || '').slice(0, 60),
        billing_city: String(guest.city || ''),
        billing_state: String(guest.guestState || guest.state || ''),
        billing_zip: String(guest.postal || guest.zip || ''),
        billing_country: String(guest.country || ''),
        // optional: if you capture IP on FE and send it along
        // ipaddress: req.ip, 
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
      const friendly = friendlyNmiMessage(nmi);
      return res.status(402).json({
        success: false,
        message: friendly,        
        code: nmi.respcode || nmi.response_code || null,
        avs: nmi.avsresponse || null,
        cvv: nmi.cvvresponse || nmi.cvverror || null,
        nmi,                         
      });
    }

    const transactionId = nmi.transactionid || nmi.transaction_id || null;

    //  CREATE RESERVATION (Metasphere)
    try {
      const msResp = await withProdTokenRetry(async (msToken) => {
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
          infants: String(quote.infants || 0),
          pets: String(quote.pets || 0),
          totalPrice: String(baseAmount.toFixed(2)),
          currency: currency,
          membershipNo: String(guest.membershipNo || ''),
          token: msToken
        };

        const msForm = qs.stringify(createPayload);
        return axios.post(
          apiBaseUrl + 'CreateReservation_Mobile',
          msForm,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
        );
      });

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


//Check member in CRM
router.post('/check-member', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

  try {
    const response = await withProdTokenRetry((token) =>
      axios.post(
        apiBaseUrl + 'GetPrivateProfile',
        qs.stringify({ email, flag: 0, token }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
      )
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
    const response = await withProdTokenRetry((token) => {
      const payload = { ...bookingData, token };
      return axios.post(
        apiBaseUrl + 'CreateReservation_Mobile',
        qs.stringify(payload),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent }
      );
    });

    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('Create Reservation error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to create reservation', error: err.response?.data || err.message });
  }
});

module.exports = router;


