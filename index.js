// index.js

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const axios = require('axios');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Temporary CORS Bypass (for testing only)
app.use(cors({
  origin: (origin, callback) => {
    callback(null, true); // Reflects all origins (bypass)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight OPTIONS requests globally
app.options('*', cors());

// Core middlewares
app.use(express.json());
app.use(cookieParser());

// Route handlers (loaded after app init)
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');

// Mount routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(` Server running on port ${PORT}`);
});

// Token fetch helper — exposed for internal use
const getToken = async () => {
  const appkey = process.env.APP_KEY || "41787349523ac4f6";
  const appSecret = process.env.APP_SECRET || "ftObPzm7cQyv2jpyxH9BXd3vBCr8Y-FGIoQsBRMpeX8";

  try {
    const response = await axios.post(
      `${process.env.API_BASE_URL}/ClaimVoucher`,
      { appkey, appSecret }
    );

    const token = response.data?.token;

    if (!token) {
      console.warn(" Token not found in response:", response.data);
      return null;
    }

    return token;
  } catch (err) {
    console.error(" Error fetching token:", err.message);
    return null;
  }
};

// Export for testing or internal re-use
module.exports = { app, getToken };
