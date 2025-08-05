require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');

// Initialize Express app
const app = express();

// ======================
// Enhanced CORS Configuration
// ======================
const allowedOrigins = [
  'https://member.dreamtripclub.com',
  'http://localhost:3000'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, origin); // Return SINGLE allowed origin
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Explicit preflight handling

// ======================
// Middlewares
// ======================
app.use(express.json()); // Body parser
app.use(cookieParser()); // Cookie handler
app.use(express.urlencoded({ extended: true })); // Form data parser

// ======================
// Rate Limiting (Security)
// ======================
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per window
});
app.use(limiter);

// ======================
// Routes
// ======================
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');

app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);

// ======================
// Error Handling Middleware
// ======================
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'SERVER_ERROR'
    }
  });
});

// ======================
// Token Handler (Improved)
// ======================
const getToken = async () => {
  try {
    const response = await axios.post(
      `${process.env.API_BASE_URL}/ClaimVoucher`,
      {
        appkey: process.env.APP_KEY,
        appSecret: process.env.APP_SECRET
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000 // 5-second timeout
      }
    );

    return response.data?.token || null;
  } catch (err) {
    console.error('[TOKEN ERROR]', err.response?.data || err.message);
    return null;
  }
};

// ======================
// Server Startup
// ======================
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🛡️  CORS allowed for: ${allowedOrigins.join(', ')}`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  server.close(() => {
    console.log('✅ Server terminated');
    process.exit(0);
  });
});

module.exports = { app, getToken };