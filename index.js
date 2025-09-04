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

// CORS configuration ONLY - let cors middleware handle preflight automatically
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://member.dreamtripclub.com',
    'https://www.member.dreamtripclub.com',
    'https://dreamtripclub.com',
    'https://www.dreamtripclub.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Set-Cookie']
}));

// REMOVE the app.options line completely - let cors middleware handle it

// Middlewares


app.use(express.json());
app.use(cookieParser());
app.use('/api/user', userRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/auth', authRoutes);
app.use((req, res, next) => {
  console.log('Request Origin:', req.headers.origin);
  console.log('Request Method:', req.method);
  console.log('Request Path:', req.path);
  next();
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});