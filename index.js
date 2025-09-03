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


const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://member.dreamtripclub.com',
  'https://www.dreamtripclub.com',
  'https://dreamtripclub.com' // ← YOUR WORDPRESS SITE
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
//app.use(cors());

app.use(express.json());
app.use(cookieParser());
app.use('/api/user', userRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payments', paymentsRoutes); // payments route updated august 14 2025

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// token handler.
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