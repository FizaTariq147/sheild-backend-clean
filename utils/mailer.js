import brevo from "@getbrevo/brevo";

export const sendMail = async ({ to, subject, text, html }) => {
  const apiInstance = new brevo.TransactionalEmailsApi();

  apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
  );

  const email = new brevo.SendSmtpEmail();

  email.sender = {
    name: "SHEILD App",
    email: "fizatariq953@gmail.com", // must be verified in Brevo
  };

  email.to = [{ email: to }];
  email.subject = subject;
  email.htmlContent = html || `<p>${text}</p>`;
  email.textContent = text || "";

  await apiInstance.sendTransacEmail(email);
};