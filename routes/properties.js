const express = require("express");
const axios = require("axios");
const https = require("https");
const { getToken } = require("../services/getToken");

const router = express.Router();
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

router.get("/list", async (req, res) => {
  try {
    const token = await getToken();

    const url = `https://crm.metasphere.global:8966/api/GetPropertyList_Moblie?token=${token}`;
    const { data } = await axios.post(url, {}, { httpsAgent });

    const raw = Array.isArray(data?.data) ? data.data : [];

    const properties = raw
      .filter(
        (p) =>
          p &&
          p.hotelId &&
          p.hotelId !== "All" &&
          p.propertyName &&
          p.propertyName !== "All"
      )
      .map((p) => ({
        hotelId: String(p.hotelId),          // Meta value (keep as-is)
        propertyName: String(p.propertyName),
        address: String(p.address || ""),
        description: String(p.description || ""),
      }));

    res.json({
      ok: true,
      properties,
    });
  } catch (err) {
    console.error("GetPropertyList_Moblie error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load properties",
    });
  }
});

module.exports = router;
