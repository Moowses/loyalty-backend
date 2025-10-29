const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const signupRoutes = require('./routes/signup');
const userRoutes = require('./routes/user');
const bookingRoutes  = require('./routes/booking'); 
const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');
const resetPassword = require('./routes/reset-password');
const requestPasswordReset = require('./routes/request-password-reset');

dotenv.config();

const app = express();

// 0) If behind a proxy/HTTPS terminator
app.set('trust proxy', 1);

// 1) CORS (with proper IP origins)
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://member.dreamtripclub.com',
  'https://www.dreamtripclub.com',
  'https://dreamtripclub.com',
  'https://loyalty-frontend-main.vercel.app',
  'http://128.77.24.76',
  'https://128.77.24.76',
];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.dreamtripclub.com')) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// 2) Body parsers (ONCE)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 3) Cookies (BEFORE any routes)
app.use(cookieParser());

// 4) No-store headers for auth-sensitive APIs (BEFORE routes)
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/auth') ||
    req.path.startsWith('/api/user') ||
    req.path.startsWith('/api/booking') ||
    req.path.startsWith('/api/payments')
  ) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }
  next();
});

// 5) Rate limiter(s)
const resetLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Please wait 3 minutes before requesting another reset link.' },
});

// 6) Routes
app.use('/api/auth/signup', signupRoutes);
app.use('/api/auth/reset-password', resetPassword);
app.use('/api/auth/request-password-reset', resetLimiter, requestPasswordReset);

app.use('/api/user', userRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/auth', authRoutes);

// 7) Listener
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
