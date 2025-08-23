// utils/sendTempPasswordEmail.js
const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function sendTempPasswordEmail(email, tempPassword) {
  try {
    // Validate environment variables
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    
    if (!process.env.FROM_EMAIL) {
      throw new Error('FROM_EMAIL is not configured');
    }

    // Send email using Resend
    const response = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: 'Your Login Password for Tabitha',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin-bottom: 10px;">Tabitha AI</h1>
            <h2 style="color: #666; font-weight: normal;">Your Account Credentials</h2>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0 0 15px 0; color: #333;">Welcome! Your account has been created successfully.</p>
            <p style="margin: 0 0 15px 0; color: #333;">Your temporary password is:</p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="font-size: 24px; font-weight: bold; color: #007bff; letter-spacing: 2px; background-color: white; padding: 15px 25px; border-radius: 6px; border: 2px solid #007bff;">
                ${tempPassword}
              </span>
            </div>
            <p style="margin: 0; color: #666; font-size: 14px;">Please change this password after your first login.</p>
          </div>
          
          <div style="background-color: #d4edda; padding: 15px; border-radius: 6px; border-left: 4px solid #28a745;">
            <p style="margin: 0; color: #155724; font-size: 14px;">
              <strong>Next Steps:</strong> Use this password to log in and update your profile settings.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0; color: #999; font-size: 12px;">
              This email was sent by Tabitha Account Management System
            </p>
          </div>
        </div>
      `,
      text: `Welcome to Tabitha! Your temporary password is: ${tempPassword}.`
    });

    console.log(`✅ Password email sent successfully to ${email}`);
    // FIXED: Resend API returns the ID directly on the response object
    console.log(`📧 Email ID: ${response.id || response.data?.id || 'unknown'}`);
    
    return response;
  } catch (error) {
    console.error(`❌ Failed to send email to ${email}:`, error.message);
    throw error;
  }
};