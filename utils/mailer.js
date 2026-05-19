// utils/mailer.js
console.log("✅ BREVO MAILER LOADED (fetch-based, no nodemailer)");

export const sendMail = async ({ to, subject, text, html }) => {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not set in environment variables");
  }

  console.log(`📧 Attempting to send email to: ${to}`);

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Accept":       "application/json",
      "Content-Type": "application/json",
      "api-key":      apiKey,
    },
    body: JSON.stringify({
      sender: {
        name:  "SHIELD App",
        email: "fizatariq953@gmail.com", // must be verified in Brevo
      },
      to:          [{ email: to }],
      subject:     subject,
      htmlContent: html  || `<p>${text}</p>`,
      textContent: text  || "",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ Brevo API error:", JSON.stringify(data));
    throw new Error(`Brevo API error ${response.status}: ${JSON.stringify(data)}`);
  }

  console.log("✅ Email sent! messageId:", data.messageId);
  return data;
};