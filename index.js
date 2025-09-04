// index.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

const userRoutes = require('./routes/user');
const bookingRoutes = require('./routes/booking');
const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');

dotenv.config();

const app = express();

// Behind Cloudflare/Nginx; required for secure cookies, IPs, etc.
app.set('trust proxy', 1);

// ---- CORS (single global instance) ----
const allowedOrigins = [
  /^http:\/\/localhost:3000$/,               // local dev
  /^https:\/\/member\.dreamtripclub\.com$/,  // prod app
  /^https:\/\/www\.dreamtripclub\.com$/,     // optional
  /^https:\/\/dreamtripclub\.com$/,          // optional
  /^https:\/\/.*\.dreamtripclub\.com$/       // optional: wildcard subdomains
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / Postman
    const ok = allowedOrigins.some(rx => rx.test(origin));
    return ok ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ---- Parsers / cookies ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- Routes ----
app.use('/api/user', userRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payments', paymentsRoutes); // updated Aug 14, 2025
app.use('/api/auth', authRoutes);

// (Optional) simple health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// (Optional) nicer error for CORS denials
app.use((err, _req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS blocked' });
  }
  return next(err);
});

// ---- Start server ----
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
