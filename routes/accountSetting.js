// routes/accountSetting.js
const express = require("express");
const axios = require("axios");
const https = require("https");
const path = require("path");
const fs = require("fs");

const { getToken } = require("../services/getToken"); 

const router = express.Router();

const META_URL = "https://crm.metasphere.global:8966/api/UpdateProfile_Mobile";

// Keep SSL relaxed (your other routes do this too)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ---- Load country_state.csv once ----
let COUNTRY_STATE_SET = null;

function loadCountryStateCSV() {
  try {
    const csvPath = path.join(__dirname, "..", "data", "country_state.csv");
    const raw = fs.readFileSync(csvPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    // remove header row
    lines.shift();

    const set = new Set();
    for (const line of lines) {
      const [country_name, State_Province, country_code] = line
        .split(",")
        .map((s) => (s ?? "").trim());

      if (!country_name || !State_Province || !country_code) continue;

      const key = `${country_name.toLowerCase()}|${State_Province.toLowerCase()}|${country_code.toUpperCase()}`;
      set.add(key);
    }

    COUNTRY_STATE_SET = set;
    console.log(`[accountSetting] Loaded country_state.csv: ${set.size} rows`);
  } catch (err) {
    COUNTRY_STATE_SET = null;
    console.warn(
      "[accountSetting] country_state.csv not loaded (validation disabled):",
      err.message
    );
  }
}
loadCountryStateCSV();

function requireField(body, key) {
  const v = body?.[key];
  if (v === undefined || v === null || String(v).trim() === "") {
    const e = new Error(`Missing required field: ${key}`);
    e.status = 400;
    throw e;
  }
  return String(v).trim();
}

function validateCountryState({ Country, StateProvince }) {
  if (!COUNTRY_STATE_SET) return;

  const code = String(Country || "").toUpperCase();
  const prov = String(StateProvince || "").toLowerCase();

  // We validate province+country_code against any country_name in the CSV
  let ok = false;
  for (const k of COUNTRY_STATE_SET) {
    if (k.endsWith(`|${prov}|${code}`)) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    const e = new Error(
      `Invalid Country/StateProvince combo. Country=${Country}, StateProvince=${StateProvince}`
    );
    e.status = 400;
    throw e;
  }
}

/**
 * POST /api/user/account-settings
 */
router.post("/account-settings", async (req, res) => {
  try {
    // REQUIRED
    const ProfileId = requireField(req.body, "ProfileId");
    const FirstName = requireField(req.body, "FirstName");
    const LastName = requireField(req.body, "LastName");
    const Country = requireField(req.body, "Country"); // e.g. CA
    const StateProvince = requireField(req.body, "StateProvince"); // e.g. Ontario

    // OPTIONAL (Meta accepts these)
    const Title = (req.body.Title ?? "").trim();
    const DateofBirth = (req.body.DateofBirth ?? "").trim(); // YYYY-MM-DD
    const Gender = (req.body.Gender ?? "").trim();
    const Nationality = (req.body.Nationality ?? Country).trim();
    const Company = (req.body.Company ?? "").trim();
    const DocumentType = (req.body.DocumentType ?? "").trim();
    const Region = (req.body.Region ?? StateProvince).trim();
    const Destinations = (req.body.Destinations ?? "").trim();
    const Phone = (req.body.Phone ?? "").trim();

    // Validate using CSV
    validateCountryState({ Country, StateProvince });

    // ✅ Get Meta token
    const token = await getToken();
    if (!token) {
      return res
        .status(500)
        .json({ result: "error", message: "Token generation failed", meta: null });
    }

    const params = {
      token,
      Title,
      DateofBirth,
      FirstName,
      LastName,
      Gender,
      Nationality,
      Company,
      DocumentType,
      Region,
      Country,
      StateProvince,
      Destinations,
      Phone,
      ProfileId,
    };

    // remove empty strings (avoid Meta rejecting)
    Object.keys(params).forEach((k) => {
      if (params[k] === "") delete params[k];
    });

    const metaResp = await axios.get(META_URL, {
      params,
      httpsAgent,
      timeout: 30000,
    });

    return res.json({
      result: "success",
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
