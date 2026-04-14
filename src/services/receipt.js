const { saveBuffer } = require("./storage");

function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createSimplePdf(lines) {
  const content = [
    "BT",
    "/F1 12 Tf",
    "50 780 Td",
    ...lines.flatMap((line, index) => {
      const instruction = `(${escapePdfText(line)}) Tj`;
      return index === 0 ? [instruction] : ["0 -18 Td", instruction];
    }),
    "ET"
  ].join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(content, "utf8")} >> stream\n${content}\nendstream endobj`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function generateReceipt(order) {
  const lines = [
    "Marketplace Order Receipt",
    `Order ID: ${order.id}`,
    `Buyer: ${order.buyer_name} (${order.buyer_phone})`,
    `Seller: ${order.seller_name || order.seller_id}`,
    `Payment Mode: ${order.payment_mode}`,
    `Status: ${order.status}`,
    `Address: ${order.address}`,
    `Amount: ${order.total_amount}`,
    "Items:"
  ];

  for (const item of order.items || []) {
    lines.push(`- ${item.product_name} x ${item.quantity} @ ${item.price}`);
  }

  const buffer = createSimplePdf(lines);
  return saveBuffer(buffer, "receipts", `${order.id}.pdf`);
}

module.exports = {
  generateReceipt
};
