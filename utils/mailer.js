import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendMail = async ({ to, subject, text, html }) => {
  const { data, error } = await resend.emails.send({
    from: "SHEILD App <noreply@sheildapp.com>",
    to,
    subject,
    html: html || `<p>${text}</p>`,
  });

  if (error) throw new Error(error.message);
  return data;
};