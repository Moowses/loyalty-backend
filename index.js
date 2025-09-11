const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const signupRoutes = require('./routes/signup');
const userRoutes = require('./routes/user');
const bookingRoutes  = require('./routes/booking'); 
const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');
const resetPassword = require('./routes/reset-password');
const requestPasswordReset = require('./routes/request-password-reset');

//const testSignupRoutes = require('./routes/testsignup');

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://member.dreamtripclub.com',
  'https://www.dreamtripclub.com',
  'https://dreamtripclub.com',
  '128.77.24.76' // ← YOUR WORDPRESS SITE
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.dreamtripclub.com')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));


// Middlewares

app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

//app.use(cors());
//test sign up with encryption
//app.use('/api/testsignup', testSignupRoutes);
app.use('/api/auth/signup', signupRoutes); // suignup route
app.use('/api/auth/reset-password', resetPassword); // reset password route
 app.use('/api/auth/request-password-reset', requestPasswordReset); // request password reset route




app.use(express.json());


app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.use(cookieParser());
app.use('/api/user', userRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payments', paymentsRoutes); // payments route updated august 14 2025

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
