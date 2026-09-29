export async function handleEmail(payload) {
  console.log("Sending email to:", payload.email);

  await new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });

  console.log("Email sent to:", payload.email);
}
