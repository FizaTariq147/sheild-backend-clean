import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export const sendMail = async ({ to, subject, text, html }) => {
  await transporter.sendMail({
    from: `"SHEILD App" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html: html || `<p>${text}</p>`,
  });
};