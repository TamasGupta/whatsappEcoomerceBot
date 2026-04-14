const fs = require("fs");
const path = require("path");
const { appBaseUrl, uploadsDir, whatsappToken } = require("../config");

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilename(filename) {
  return String(filename || "file.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getPublicUrl(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return `${appBaseUrl}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function saveBuffer(buffer, folder, filename) {
  const safeFilename = sanitizeFilename(filename);
  const targetFolder = path.join(uploadsDir, folder);
  ensureDirectory(targetFolder);
  const absolutePath = path.join(targetFolder, safeFilename);
  fs.writeFileSync(absolutePath, buffer);
  const relativePath = `/uploads/${folder}/${safeFilename}`;
  return {
    absolutePath,
    relativePath,
    publicUrl: getPublicUrl(relativePath)
  };
}

function saveDataUrl(dataUrl, folder, filenameBase) {
  const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid data URL.");
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const extension = mimeType.split("/")[1]?.split(";")[0] || "bin";
  const buffer = Buffer.from(base64Data, "base64");
  return saveBuffer(buffer, folder, `${filenameBase}.${extension}`);
}

async function fetchWhatsAppMediaMetadata(mediaId) {
  const response = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${whatsappToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch WhatsApp media metadata: ${response.status}`);
  }

  return response.json();
}

async function downloadWhatsAppMedia(mediaId, filenameBase) {
  if (!whatsappToken) {
    throw new Error("WhatsApp token is not configured.");
  }

  const metadata = await fetchWhatsAppMediaMetadata(mediaId);
  const response = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${whatsappToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download WhatsApp media: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const extension = metadata.mime_type?.split("/")[1] || "bin";
  return saveBuffer(Buffer.from(arrayBuffer), "payments", `${filenameBase}.${extension}`);
}

module.exports = {
  downloadWhatsAppMedia,
  ensureDirectory,
  getPublicUrl,
  saveBuffer,
  saveDataUrl
};
