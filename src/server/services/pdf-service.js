import PDFDocument from "pdfkit";

function writeCvDocumentHeader(document, title) {
  document
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#111827")
    .text(title);

  document
    .moveDown(0.4)
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#6B7280")
    .text(`Generated: ${new Date().toLocaleString()}`)
    .moveDown(1);
}

function writeCandidateCv(document, candidate) {
  document
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#111827")
    .text(candidate.name);

  document
    .moveDown(0.3)
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#374151")
    .text(`Target Role: ${candidate.role}`)
    .text(`Application Status: ${candidate.status}`)
    .text(`Profile Created: ${new Date(candidate.created_at).toLocaleDateString()}`)
    .moveDown(0.8);

  document
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111827")
    .text("Summary")
    .moveDown(0.2)
    .font("Helvetica")
    .fillColor("#374151")
    .text(candidate.notes, {
      align: "left",
      lineGap: 2
    })
    .moveDown(1.2);
}

export function buildAvailableCandidatesPdf(candidates) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];

    document.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    document.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    document.on("error", reject);

    writeCvDocumentHeader(document, "Available Applicants CV Packet");

    candidates.forEach((candidate, index) => {
      writeCandidateCv(document, candidate);

      if (index < candidates.length - 1) {
        document.addPage();
      }
    });

    document.end();
  });
}
