import { handleEmail } from "../handlers/emailHandler.js";
import { handlePdf } from "../handlers/pdfHandler.js";

export async function processJob(job) {
  const { type, payload } = job;

  switch (type) {
    case "email":
      await handleEmail(payload);
      break;

    case "pdf":
      await handlePdf(payload);
      break;

    case "fail":
      throw new Error("Intentional failure for testing");

    default:
      throw new Error(`Unsupported job type: ${type}`);
  }
}
