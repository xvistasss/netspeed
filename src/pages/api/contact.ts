import type { APIRoute } from "astro";
import { checkRateLimit, getClientIP, createRateLimitHeaders } from "./rateLimiter";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
};

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({ error: "Method not allowed. Use POST to submit contact form." }),
    {
      status: 405,
      headers: {
        ...corsHeaders,
        Allow: "POST, OPTIONS",
      },
    },
  );
};

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Rate limiting: 5 submissions per 10 minutes per client IP
    const clientIP = getClientIP(request?.headers);
    const rateLimit = checkRateLimit(`contact-${clientIP}`, {
      maxRequests: 5,
      windowMs: 10 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many contact requests. Please try again later." }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
            "Retry-After": Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000)).toString(),
          },
        },
      );
    }

    // 2. Safe JSON Body Parsing
    let data: any;
    try {
      data = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON request payload." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    if (!data || typeof data !== "object") {
      return new Response(
        JSON.stringify({ error: "Request body must be a JSON object." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const { name, email, subject, message } = data;

    // 3. Field validation
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "All fields (name, email, subject, message) are required." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const trimmedName = String(name).trim().slice(0, 200);
    const trimmedEmail = String(email).trim().slice(0, 254);
    const trimmedSubject = String(subject).trim().slice(0, 200);
    const trimmedMessage = String(message).trim().slice(0, 5000);

    if (!trimmedName || !trimmedEmail || !trimmedSubject || !trimmedMessage) {
      return new Response(
        JSON.stringify({ error: "Please fill out all fields." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const submission = {
      id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `sub-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      name: trimmedName,
      email: trimmedEmail,
      subject: trimmedSubject,
      message: trimmedMessage,
    };

    let emailSent = false;
    let emailMessage = "Submission received";

    // 4. Optional Email dispatch (SMTP via nodemailer if configured)
    const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: parseInt(env.SMTP_PORT || "587", 10),
          secure: env.SMTP_SECURE === "true",
          auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          },
        });

        const safeName = escapeHtml(trimmedName);
        const safeEmail = escapeHtml(trimmedEmail);
        const safeSubject = escapeHtml(trimmedSubject);
        const safeMessage = escapeHtml(trimmedMessage).replace(/\n/g, "<br>");

        const mailOptions = {
          from: `"NetSpeed Contact" <${env.SMTP_USER}>`,
          to: env.CONTACT_EMAIL || env.SMTP_USER,
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
      } catch (err: any) {
        console.error("[Contact SMTP Error]", err?.message || err);
        emailMessage = "Submission received, notification dispatch pending.";
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: emailMessage,
        emailSent,
        data: {
          id: submission.id,
          timestamp: submission.timestamp,
        },
      }),
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (err: any) {
    console.error("[Contact API Global Error]", err?.message || err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
};
