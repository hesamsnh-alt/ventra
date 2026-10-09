const SUPPORTED_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
];

export function getFileExtension(fileName = "") {
  return (
    fileName
      .split(".")
      .pop()
      ?.toLowerCase() || ""
  );
}

export function validateUploadedFile({
  fileUrl,
  fileName,
  fileType,
}) {
  if (!fileUrl) {
    const error = new Error(
      "File URL is required."
    );

    error.status = 400;
    throw error;
  }

  if (!fileName) {
    const error = new Error(
      "File name is required."
    );

    error.status = 400;
    throw error;
  }

  const extension =
    getFileExtension(fileName);

  const isImage = [
    "jpg",
    "jpeg",
    "png",
    "webp",
  ].includes(extension);

  const isPdf =
    extension === "pdf" ||
    fileType === "application/pdf";

  if (
    !SUPPORTED_EXTENSIONS.includes(extension) &&
    !isPdf
  ) {
    const error = new Error(
      "Only PDF, JPG, JPEG, PNG and WEBP files are supported."
    );

    error.status = 400;
    throw error;
  }

  return {
    extension,
    isImage,
    isPdf,
  };
}