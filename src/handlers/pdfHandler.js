export async function handlePdf(payload) {
  console.log("Generating PDF for:", payload.title);

  await new Promise((resolve) => {
    setTimeout(resolve, 30000);
  });

  console.log("PDF generated:", payload.title);
}
