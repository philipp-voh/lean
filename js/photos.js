// Photos are re-encoded as JPEG: that strips EXIF and GPS, and Safari can't encode WebP.

export const prepare = file => encode(file, 1600, 0.8);
export const thumb = photo => encode(new Blob([photo.bytes], { type: photo.type }), 600, 0.7);

const unreadable = () => Object.assign(new Error("Lean couldn't open this photo. Try another one."), { kind: 'photo' });

// createImageBitmap applies the EXIF rotation; <img> is the fallback for formats it can't open.
async function decode(blob) {
  try { return await createImageBitmap(blob); }
  catch {
    const url = URL.createObjectURL(blob), img = new Image();
    img.src = url;
    try { await img.decode(); return img; }
    catch { throw unreadable(); }
    finally { URL.revokeObjectURL(url); }
  }
}

async function encode(blob, longSide, quality) {
  const img = await decode(blob);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = Math.min(1, longSide / Math.max(w, h));
  const width = Math.round(w * scale), height = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';   // JPEG has no transparency: a see-through PNG would turn black and hide its text
  g.fillRect(0, 0, width, height);
  g.drawImage(img, 0, 0, width, height);
  img.close?.();
  const out = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  canvas.width = canvas.height = 0;   // frees the canvas memory at once on iOS
  if (!out) throw unreadable();
  return { bytes: await out.arrayBuffer(), type: 'image/jpeg', width, height };
}

// FileReader, because String.fromCharCode(...bytes) overflows Safari's argument limit.
export function base64(bytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
}
