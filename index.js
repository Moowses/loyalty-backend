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

const ORIGINS = [
  'http://localhost:3000',               // dev
  'https://member.dreamtripclub.com',    // prod front-end
  'https://dreamtripclub.com',       // if needed
];



app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    // Allow all subdomains of dreamtripclub.com
    if (origin.endsWith('.dreamtripclub.com')) {
      return cb(null, true);
    }
    cb(null, ORIGINS.includes(origin));
  },
  credentials: true,
}));

// Middlewares
//app.use(cors());

app.use(express.json());
app.use(cookieParser());


// Add this middleware before your routes
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://member.dreamtripclub.com',
    'https://www.dreamtripclub.com',
    'https://dreamtripclub.com'
  ];
  
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});
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