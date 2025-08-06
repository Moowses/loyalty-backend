const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const axios = require('axios'); // Added missing import

// Initialize environment variables FIRST
dotenv.config();

// Create Express app
const app = express();

// CORS Configuration
app.use(cors({
  origin: '*',
  credentials: true
}));

// Middlewares
app.use(express.json());
app.use(cookieParser());

// Route imports (AFTER app initialization)
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');

// Routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// Token handler
const getToken = async () => {
  const appkey = process.env.APP_KEY || "41787349523ac4f6"; // Move to env vars
  const appSecret = process.env.APP_SECRET || "ftObPzm7cQyv2jpyxH9BXd3vBCr8Y-FGIoQsBRMpeX8";

  try {
    const res = await axios.post(`${process.env.API_BASE_URL}/ClaimVoucher`, { // Added missing /
      appkey,
      appSecret
    });

    return res.data?.token || null;
  } catch (err) {
    console.error("Token error:", err.message);
    return null;
  }
};

module.exports = { app, getToken }; // Better export pattern