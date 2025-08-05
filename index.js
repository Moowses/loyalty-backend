const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
const axios = require('axios'); // Needed for token handler

dotenv.config(); // Load .env first

const app = express(); 

// Define allowed frontend origins
const allowedOrigins = [
  'https://member.dreamtripclub.com',
  'http://localhost:3000'
];

// Apply CORS config
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Middlewares
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Token Handler
const getToken = async () => {
  const appkey = "41787349523ac4f6";
  const appSecret = "ftObPzm7cQyv2jpyxH9BXd3vBCr8Y-FGIoQsBRMpeX8";

  try {
    const res = await axios.post(`${process.env.API_BASE_URL}ClaimVoucher`, {
      appkey,
      appSecret
    });

    if (res.data && res.data.token) {
      return res.data.token;
    } else {
      console.error("Token response missing:", res.data);
      return null;
    }
  } catch (err) {
    console.error("Error fetching token:", err.message);
    return null;
  }
};

module.exports.getToken = getToken;
