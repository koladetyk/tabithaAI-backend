const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async function sendTempPasswordEmail(email, tempPassword) {
  const msg = {
    to: email,
    from: process.env.FROM_EMAIL,
    subject: 'Your Login Password for Tabitha',
    text: `Your password is: ${tempPassword}. You can reset password if you would like to.`,
  };

  await sgMail.send(msg);
};
