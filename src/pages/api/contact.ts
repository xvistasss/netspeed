import type { APIRoute } from "astro";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { name, email, subject, message } = data;

    // 1. Validation
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 2. Basic input sanitization
    const trimmedName = String(name).trim().slice(0, 200);
    const trimmedEmail = String(email).trim().slice(0, 254);
    const trimmedSubject = String(subject).trim().slice(0, 200);
    const trimmedMessage = String(message).trim().slice(0, 5000);

    if (!trimmedName || !trimmedEmail || !trimmedSubject || !trimmedMessage) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const submission = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      name: trimmedName,
      email: trimmedEmail,
      subject: trimmedSubject,
      message: trimmedMessage,
    };

    console.log(`[Contact Submission] Received at ${submission.timestamp}`);

    let emailSent = false;
    let emailMessage = "Submission received";

    // 3. Optional Email dispatch (SMTP via nodemailer if configured)
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        // Escape all user input for HTML email to prevent XSS
        const safeName = escapeHtml(trimmedName);
        const safeEmail = escapeHtml(trimmedEmail);
        const safeSubject = escapeHtml(trimmedSubject);
        const safeMessage = escapeHtml(trimmedMessage).replace(/\n/g, "<br>");

        const mailOptions = {
          from: `"NetSpeed Contact" <${process.env.SMTP_USER}>`,
          to: process.env.CONTACT_EMAIL || process.env.SMTP_USER,
          replyTo: trimmedEmail,
          subject: `NetSpeed Contact Form: ${trimmedSubject}`,
          text: `Name: ${trimmedName}\nEmail: ${trimmedEmail}\nSubject: ${trimmedSubject}\n\nMessage:\n${trimmedMessage}`,
          html: `<p><strong>Name:</strong> ${safeName}</p>
                 <p><strong>Email:</strong> ${safeEmail}</p>
                 <p><strong>Subject:</strong> ${safeSubject}</p>
                 <p><strong>Message:</strong></p>
                 <p>${safeMessage}</p>`,
        };

        await transporter.sendMail(mailOptions);
        emailSent = true;
        emailMessage = "Email dispatched successfully";
        console.log("[Contact Submission] Email sent successfully.");
      } catch (err: any) {
        console.error(
          "[Contact Submission] Failed to send email via SMTP:",
          err.message,
        );
        emailMessage = `Submission received, but SMTP email dispatch failed: ${err.message}`;
      }
    } else {
      console.log(
        "[Contact Submission] SMTP environment variables not configured. Skipping email dispatch.",
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: emailMessage,
        emailSent,
        data: submission,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("[Contact Submission Error]", err);
    return new Response(
      JSON.stringify({ error: err.message || "Server error occurred" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
