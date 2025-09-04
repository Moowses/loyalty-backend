const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const userRoutes = require('./routes/user');
const bookingRoutes  = require('./routes/booking'); 
const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');

dotenv.config();

const app = express();
app.set('trust proxy', 1);

// MANUAL CORS HANDLING - MOST RELIABLE
const cors = require('cors');

app.use(cors({
  origin: 'https://member.dreamtripclub.com',
  credentials: true
}));

// Explicitly handle OPTIONS for all routes
app.options('*', cors());

app.use((req, res, next) => {
  // Monkey-patch res.send to log headers before sending
  const originalSend = res.send;
  res.send = function(body) {
    console.log('=== RESPONSE HEADERS ===');
    console.log('Access-Control-Allow-Origin:', res.getHeader('Access-Control-Allow-Origin'));
    console.log('Access-Control-Allow-Credentials:', res.getHeader('Access-Control-Allow-Credentials'));
    console.log('Status:', res.statusCode);
    return originalSend.call(this, body);
  };
  next();
});

app.use((req, res, next) => {
  console.log('=== CORS DEBUG ===');
  console.log('Origin:', req.headers.origin);
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  next();
});

// Middlewares
app.use(express.json());
app.use(cookieParser());
app.use('/api/user', userRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});