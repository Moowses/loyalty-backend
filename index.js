const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
const axios = require('axios');

dotenv.config();

const app = express();

// 1. Fixed allowed origins (removed trailing slash)
const allowedOrigins = [
  'https://member.dreamtripclub.com',
  'http://localhost:3000',
  'https://loyalty-frontend-main.vercel.app' // Removed trailing slash
];

// 2. Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check against allowed origins
    if (allowedOrigins.some(allowedOrigin => 
      origin === allowedOrigin || 
      origin.startsWith(allowedOrigin.replace(/https?:\/\//, ''))
    )) {
      return callback(null, true);
    }
    
    console.error(`CORS Blocked: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// 3. Apply CORS middleware
app.use(cors(corsOptions));

// 4. Explicitly handle OPTIONS requests
app.options('*', cors(corsOptions)); // Enable preflight for all routes

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
