const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async function sendTempPasswordEmail(email, tempPassword) {
  const msg = {
    to: email,
    from: process.env.DEFAULT_EMAIL_FROM || 'no-reply@yourdomain.com',
    subject: 'Your Temporary Login Password',
    text: `Your temporary password is: ${tempPassword}. Please log in and change it immediately.`,
  };

  await sgMail.send(msg);
};
