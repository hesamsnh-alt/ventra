import { PDFDocument } from "pdf-lib";

const DEFAULT_MAX_PAGES = 150;

export async function loadPdf(fileBuffer, { maxPages = DEFAULT_MAX_PAGES } = {}) {
  const pdf = await PDFDocument.load(fileBuffer, {
    ignoreEncryption: false,
    updateMetadata: false,
  });

  const totalPages = pdf.getPageCount();

  if (totalPages < 1) {
    throw new Error("The uploaded PDF does not contain any pages.");
  }

  if (totalPages > maxPages) {
    throw new Error(
      `This PDF contains ${totalPages} pages. The current analysis limit is ${maxPages} pages per file.`
    );
  }

  return { pdf, totalPages };
}

export async function extractPdfPage(pdf, pageIndex) {
  const singlePagePdf = await PDFDocument.create();
  const [page] = await singlePagePdf.copyPages(pdf, [pageIndex]);
  singlePagePdf.addPage(page);

  return singlePagePdf.save({
    useObjectStreams: true,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

export async function extractPdfPagePacket(pdf, pageIndexes) {
  const packet = await PDFDocument.create();
  const copied = await packet.copyPages(pdf, pageIndexes);
  for (const page of copied) packet.addPage(page);
  return packet.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false});
}

export async function splitPdf(fileBuffer, options = {}) {
  const { pdf, totalPages } = await loadPdf(fileBuffer, options);
  const pages = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    pages.push({
      pageNumber: pageIndex + 1,
      bytes: await extractPdfPage(pdf, pageIndex),
      status: "pending",
    });
  }

  return { totalPages, pages };
}
