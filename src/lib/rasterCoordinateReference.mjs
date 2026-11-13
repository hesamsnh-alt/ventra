import sharp from 'sharp';

// A second view supplies a visible ruler, while the first image stays untouched.
// The overlay never participates in ink validation or metric scale evidence.
export async function rasterCoordinateReference(buffer, width, height) {
  const step = Math.max(100, Math.ceil(Math.max(width, height) / 12 / 100) * 100);
  const marks = [];
  for (let x = 0; x < width; x += step) {
    marks.push(`<path d="M${x} 0V${height}"/><text x="${x + 3}" y="16">x=${x}</text>`);
  }
  for (let y = step; y < height; y += step) {
    marks.push(`<path d="M0 ${y}H${width}"/><text x="3" y="${y - 4}">y=${y}</text>`);
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g stroke="#1675bb" stroke-opacity=".38" stroke-width="1" stroke-dasharray="3 6" fill="#07588e" font-family="sans-serif" font-size="14">${marks.join('')}</g></svg>`);
  const data = await sharp(buffer).composite([{ input: overlay }]).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
  return { type: 'input_image', image_url: `data:image/jpeg;base64,${data.toString('base64')}`, detail: 'high' };
}
