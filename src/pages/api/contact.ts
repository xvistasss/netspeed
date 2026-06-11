import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { name, email, subject, message } = data;

    // 1. Validation
    if (!name || !email || !subject || !message) {
      return new Response(JSON.stringify({ error: 'All fields are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const submission = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      name,
      email,
      subject,
      message
    };

    // 2. Local Storage (Save to src/data/contacts.json)
    let savedLocally = false;
    try {
      const dataDir = path.resolve('src/data');
      await fs.mkdir(dataDir, { recursive: true });
      const filePath = path.join(dataDir, 'contacts.json');

      let submissions = [];
      try {
        const existingData = await fs.readFile(filePath, 'utf-8');
        submissions = JSON.parse(existingData);
      } catch (e) {
        // File doesn't exist or is empty
      }

      submissions.push(submission);
      await fs.writeFile(filePath, JSON.stringify(submissions, null, 2), 'utf-8');
      savedLocally = true;
      console.log(`[Contact Submission] Saved locally. Timestamp: ${submission.timestamp}`);
    } catch (fsErr: any) {
      console.warn(`[Contact Submission] Local storage is not available/failed: ${fsErr.message}`);
    }

    console.log(`[Contact Submission Details]`);
    console.log(`- Timestamp: ${submission.timestamp}`);
    console.log(`- From: ${name} <${email}>`);
    console.log(`- Subject: ${subject}`);
    console.log(`- Message: ${message}`);

    let emailSent = false;
    let emailMessage = savedLocally 
      ? 'Saved locally to src/data/contacts.json' 
      : 'Submission received (local file storage unavailable)';

    // 3. Optional Email dispatch (SMTP via nodemailer if configured)
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        const mailOptions = {
          from: `"NetSpeed Contact" <${process.env.SMTP_USER}>`,
          to: process.env.CONTACT_EMAIL || process.env.SMTP_USER,
          replyTo: email,
          subject: `NetSpeed Contact Form: ${subject}`,
          text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
          html: `<p><strong>Name:</strong> ${name}</p>
                 <p><strong>Email:</strong> ${email}</p>
                 <p><strong>Subject:</strong> ${subject}</p>
                 <p><strong>Message:</strong></p>
                 <p>${message.replace(/\n/g, '<br>')}</p>`,
        };

        await transporter.sendMail(mailOptions);
        emailSent = true;
        emailMessage = savedLocally 
          ? 'Saved locally & email dispatched successfully' 
          : 'Email dispatched successfully (local storage unavailable)';
        console.log('[Contact Submission] Email sent successfully.');
      } catch (err: any) {
        console.error('[Contact Submission] Failed to send email via SMTP:', err.message);
        emailMessage = savedLocally
          ? `Saved locally, but SMTP email dispatch failed: ${err.message}`
          : `Submission received, but SMTP email dispatch failed: ${err.message}`;
      }
    } else {
      console.log('[Contact Submission] SMTP environment variables not configured. Skipping email dispatch.');
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: emailMessage,
      emailSent,
      data: submission 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[Contact Submission Error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Server error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
