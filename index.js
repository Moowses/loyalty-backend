const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const axios = require('axios');

// 1. Environment Setup
dotenv.config({
  path: process.env.NODE_ENV === 'production' 
    ? '.env.production' 
    : '.env.development'
});

// 2. Express Initialization
const app = express();

// 3. Temporary CORS Bypass (Development Only)
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: true, // Reflects request origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.options('*', cors());
} else {
  // Production CORS (Strict)
  const allowedOrigins = ['https://member.dreamtripclub.com'];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }));
}

// 4. Security Middlewares
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// 5. Rate Limiting
const limiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP
});
app.use('/api/', limiter);

// 6. Routes
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);

// 7. Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 8. Error Handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 9. Token Handler (Secure)
const getToken = async () => {
  try {
    const { data } = await axios.post(
      `${process.env.API_BASE_URL}/ClaimVoucher`,
      {
        appkey: process.env.APP_KEY,
        appSecret: process.env.APP_SECRET
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000 // 5s timeout
      }
    );
    return data?.token || null;
  } catch (err) {
    console.error('Token Error:', err.response?.data || err.message);
    return null;
  }
};

// 10. Server Startup
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
   Server running in ${process.env.NODE_ENV || 'development'} mode
   Port: ${PORT}
   CORS: ${process.env.NODE_ENV === 'production' ? 'Strict' : 'Permissive'}
  `);
});

module.exports = { app, getToken };