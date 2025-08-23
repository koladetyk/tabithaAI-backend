// utils/sendTempPasswordEmail.js
const https = require('https');

// Send temporary password email for new contacts
async function sendTempPasswordEmail(email, tempPassword) {
  return sendEmailJSTemplate({
    templateId: process.env.EMAILJS_TEMP_PASSWORD_TEMPLATE_ID,
    toEmail: email,
    templateParams: {
      to_email: email,
      to_name: email.split('@')[0], // Use part before @ as name
      temp_password: tempPassword,
      subject: 'Your Login Credentials for Tabitha AI'
    }
  });
}

// Send password reset email  
async function sendResetEmail(email, resetCode) {
  return sendEmailJSTemplate({
    templateId: process.env.EMAILJS_RESET_PASSWORD_TEMPLATE_ID,
    toEmail: email,
    templateParams: {
      to_email: email,
      reset_code: resetCode,
      subject: 'Tabitha AI - Password Reset Code'
    }
  });
}

// Generic EmailJS sender function
async function sendEmailJSTemplate({ templateId, toEmail, templateParams }) {
  try {
    // Validate environment variables
    if (!process.env.EMAILJS_PUBLIC_KEY) {
      throw new Error('EMAILJS_PUBLIC_KEY is not configured');
    }
    
    if (!process.env.EMAILJS_PRIVATE_KEY) {
      throw new Error('EMAILJS_PRIVATE_KEY is not configured');
    }
    
    if (!process.env.EMAILJS_SERVICE_ID) {
      throw new Error('EMAILJS_SERVICE_ID is not configured');
    }
    
    if (!templateId) {
      throw new Error('Template ID is not configured');
    }

    // Prepare email data
    const emailData = {
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: templateId,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: templateParams
    };

    // Send email via EmailJS REST API
    const response = await makeEmailJSRequest(emailData);

    console.log(`✅ Email sent successfully to ${toEmail}`);
    console.log(`📧 EmailJS Response: Success`);
    
    return { success: true, response };
  } catch (error) {
    console.error(`❌ Failed to send email to ${toEmail}:`, error.message);
    throw error;
  }
}

function makeEmailJSRequest(data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: 'api.emailjs.com',
      port: 443,
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(responseData);
        } else {
          reject(new Error(`EmailJS API Error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// Export both functions
module.exports = sendTempPasswordEmail;
module.exports.sendResetEmail = sendResetEmail;