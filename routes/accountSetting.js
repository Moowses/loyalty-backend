// routes/accountSetting.js
const express = require("express");
const axios = require("axios");
const https = require("https");
const path = require("path");
const fs = require("fs");
const qs = require("qs");

const { withProdTokenRetry } = require("../services/getToken");

const router = express.Router();

const META_URL = "https://crm.metasphere.global:8966/api/UpdateProfile_Mobile";
const PROFILE_API_BASE =
  (process.env.API_BASE_URL || process.env.CRM_BASE_URL || "").replace(/\/+$/, "") ||
  "https://servicehub.metasphere.global:8966/api";
const PROFILE_URL = `${PROFILE_API_BASE}/GetPrivateProfile`;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let COUNTRY_STATE_INDEX = null;

const STATE_ALIASES = {
  PH: {
    "metro manila": "National Capital Region",
    ncr: "National Capital Region",
    "western visayas": "Rehiyon ng Kanlurang Bisaya",
    "zamboanga peninsula": "Rehiyon ng Tangway ng Sambuwangga",
    "soccsksargen": "Rehiyon ng Soccsksargen",
    "ilocos norte": "Hilagang Iloko",
    benguet: "Benget",
    marinduque: "Marinduke",
    maguindanao: "Magindanaw",
    "occidental mindoro": "Kanlurang Mindoro",
    "mountain province": "Lalawigang Bulubundukin",
    "misamis occidental": "Kanlurang Misamis",
    "negros occidental": "Kanlurang Negros",
    quezon: "Keson",
    quirino: "Kirino",
    rizal: "Risal",
    siquijor: "Sikihor",
    "southern leyte": "Katimogang Leyte",
    "surigao del norte": "Hilagang Surigaw",
    "zamboanga del norte": "Hilagang Sambuwangga",
    "zamboanga del sur": "Timog Sambuwangga",
    "zamboanga sibugay": "Sambuwangga Sibugay",
  },
};

function normalizeLookupValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function loadCountryStateCSV() {
  try {
    const csvPath = path.join(__dirname, "..", "data", "country_state.csv");
    const raw = fs.readFileSync(csvPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    lines.shift();

    const byCountryCode = new Map();
    for (const line of lines) {
      const [countryName, stateProvince, countryCode] = line
        .split(",")
        .map((s) => (s ?? "").trim());

      if (!countryName || !stateProvince || !countryCode) continue;

      const upperCode = countryCode.toUpperCase();
      const stateKey = normalizeLookupValue(stateProvince);

      if (!byCountryCode.has(upperCode)) {
        byCountryCode.set(upperCode, {
          countryName,
          states: new Map(),
        });
      }

      byCountryCode.get(upperCode).states.set(stateKey, stateProvince);
    }

    COUNTRY_STATE_INDEX = byCountryCode;
    console.log(`[accountSetting] Loaded country_state.csv: ${byCountryCode.size} countries`);
  } catch (err) {
    COUNTRY_STATE_INDEX = null;
    console.warn(
      "[accountSetting] country_state.csv not loaded (validation disabled):",
      err.message
    );
  }
}
loadCountryStateCSV();

function requireField(body, key, label = key) {
  const v = body?.[key];
  if (v === undefined || v === null || String(v).trim() === "") {
    const e = new Error(`Missing required field: ${label}`);
    e.status = 400;
    throw e;
  }
  return String(v).trim();
}

function optionalField(body, key) {
  const v = body?.[key];
  return v === undefined || v === null ? "" : String(v).trim();
}

function validateCountryState({ Country, StateProvince }) {
  if (!COUNTRY_STATE_INDEX) {
    return { Country, StateProvince };
  }

  const code = String(Country || "").trim().toUpperCase();
  const countryEntry = COUNTRY_STATE_INDEX.get(code);
  if (!countryEntry) {
    const e = new Error(
      `Invalid country code. Country=${Country}`
    );
    e.status = 400;
    throw e;
  }

  const normalizedInput = normalizeLookupValue(StateProvince);
  const aliasState =
    STATE_ALIASES[code]?.[normalizedInput] ||
    countryEntry.states.get(normalizedInput);

  if (aliasState) {
    return { Country: code, StateProvince: aliasState };
  }

  const e = new Error(
    `Invalid Country/StateProvince combo. Country=${Country}, StateProvince=${StateProvince}`
  );
  e.status = 400;
  throw e;
}

function isMetaUpdateSuccess(metaData) {
  const flag = String(metaData?.flag ?? "").trim();
  const result = String(metaData?.result ?? "").trim().toLowerCase();
  return flag === "0" || result === "success";
}

function buildLocationOptions() {
  if (!COUNTRY_STATE_INDEX) {
    return {
      countries: [],
      provincesByCountryCode: {},
    };
  }

  const countries = Array.from(COUNTRY_STATE_INDEX.entries())
    .map(([code, entry]) => ({
      code,
      name: entry.countryName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const provincesByCountryCode = {};
  for (const [code, entry] of COUNTRY_STATE_INDEX.entries()) {
    provincesByCountryCode[code] = Array.from(entry.states.values()).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  return {
    countries,
    provincesByCountryCode,
  };
}

function extractProfileRow(data) {
  if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0];
  if (data?.result && typeof data.result === "object") return data.result;
  if (Array.isArray(data?.profile?.data) && data.profile.data.length > 0) {
    return data.profile.data[0];
  }
  return null;
}

async function resolveProfileFromEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    const err = new Error("Authenticated email is required.");
    err.status = 401;
    throw err;
  }

  const response = await withProdTokenRetry((token) =>
    axios.post(
      PROFILE_URL,
      qs.stringify({ email: normalizedEmail, token }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        httpsAgent,
        timeout: 30000,
      }
    )
  );

  const data = response?.data || {};
  const row = extractProfileRow(data);
  const profileId = String(row?.meta_pfprofile_id || "").trim();

  if (!row || !profileId) {
    const err = new Error("Profile or profile ID not found for the authenticated user.");
    err.status = 404;
    throw err;
  }

  return {
    row,
    profileId,
    membershipNo: String(row?.membershipno || "").trim(),
    email: String(row?.primaryemail || normalizedEmail).trim().toLowerCase(),
  };
}

router.get("/location-options", (_req, res) => {
  return res.json(buildLocationOptions());
});

router.post("/account-settings", async (req, res) => {
  try {
    const sessionEmail =
      String(req.cookies?.dtc_email || "").trim().toLowerCase() ||
      String(req.body?.email || "").trim().toLowerCase();

    const profile = await resolveProfileFromEmail(sessionEmail);

    const FirstName = requireField(req.body, "FirstName");
    const LastName = requireField(req.body, "LastName");
    const MobilePhone = requireField(req.body, "MobilePhone");
    const Country = requireField(req.body, "Country");
    const StateProvince = requireField(req.body, "StateProvince");

    const Gender = optionalField(req.body, "Gender");
    const AddressLine1 = optionalField(req.body, "AddressLine1");
    const AddressLine2 = optionalField(req.body, "AddressLine2");
    const City = optionalField(req.body, "City");
    const PostalCode = optionalField(req.body, "PostalCode");
    const Region = optionalField(req.body, "Region") || StateProvince;

    const normalizedLocation = validateCountryState({ Country, StateProvince });
    const normalizedCountry = normalizedLocation.Country;
    const normalizedStateProvince = normalizedLocation.StateProvince;

    const mailingAddress = [AddressLine1, AddressLine2].filter(Boolean).join(", ");

    const metaResp = await withProdTokenRetry(async (token) => {
      const params = {
        token,
        ProfileId: profile.profileId,
        FirstName,
        LastName,
        Gender,
        Country: normalizedCountry,
        StateProvince: normalizedStateProvince,
        State: normalizedStateProvince,
        Region: Region || normalizedStateProvince,
        Phone: MobilePhone,
        Phonenumber: MobilePhone,
        Mobilenumber: MobilePhone,
        Mailingaddress: mailingAddress,
        Address1: AddressLine1,
        Address2: AddressLine2,
        City,
        Postalcode: PostalCode,
      };

      Object.keys(params).forEach((key) => {
        if (params[key] === "") delete params[key];
      });

      return axios.get(META_URL, {
        params,
        httpsAgent,
        timeout: 30000,
      });
    });

    if (!isMetaUpdateSuccess(metaResp.data)) {
      return res.status(400).json({
        result: "error",
        message:
          metaResp.data?.result ||
          metaResp.data?.message ||
          "Account settings update failed",
        profile: {
          email: profile.email,
          membershipNo: profile.membershipNo,
        },
        meta: metaResp.data,
      });
    }

    return res.json({
      result: "success",
      profile: {
        email: profile.email,
        membershipNo: profile.membershipNo,
      },
      meta: metaResp.data,
    });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    return res.status(status).json({
      result: "error",
      message: err.message || "Account settings update failed",
      meta: err.response?.data || null,
    });
  }
});

module.exports = router;
