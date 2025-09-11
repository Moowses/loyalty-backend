require('dotenv').config();
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: 'banlasan.m@gmail.com',   // put your own email here to test
  from: process.env.SENDGRID_FROM,     // should be your authenticated domain
  subject: 'Test email from DreamTripClub',
  text: 'Hi, this is a test email sent via SendGrid API!',
};

sgMail
  .send(msg)
  .then(() => {
    console.log('✅ Test email sent successfully');
  })
  .catch((error) => {
    console.error('❌ Error sending test email:', error.response?.body || error);
  });
