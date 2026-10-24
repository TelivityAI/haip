/** Resize/compress a phone photo for upload (max edge + JPEG quality). */
export async function resizeImageToDataUrl(
  file: File,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<string> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.72;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return fileToDataUrlFallback(file);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (dataUrl.length < 64) return fileToDataUrlFallback(file);
  return dataUrl;
}

function fileToDataUrlFallback(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
