// =====================================================================
// photos.js — shrinking photos before we save them.
// =====================================================================
//
// A modern phone camera takes photos of 4–12 MB each. Storing those as-is
// would fill the phone quickly and make backups huge. So before saving, we
// draw each photo onto an invisible "canvas" (a drawing area the browser
// gives us) at a smaller size — at most 1600 pixels on the longest side —
// and save it again as a JPEG. That's still plenty sharp for reading a
// receipt or a serial-number label, but usually only 200–500 KB.

const MAX_SIZE = 1600; // longest side, in pixels
const QUALITY = 0.8; // JPEG quality: 0 (awful) to 1 (best). 0.8 is a good balance.

// Takes a File (from the camera or gallery) and gives back a smaller JPEG Blob.
export async function compressImage(file) {
  // createImageBitmap decodes the picture. "from-image" tells it to obey
  // the rotation info the camera stores in the photo, so portrait photos
  // don't come out sideways.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    // Some image formats (e.g. HEIC from iPhones) can't be decoded by Chrome.
    throw new Error('Sorry, this picture format could not be read: ' + (file.name || file.type));
  }

  // Work out the new size, keeping the same shape (aspect ratio).
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // JPEG has no transparency, so paint a white background first
  // (otherwise transparent PNGs turn black).
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close && bitmap.close();

  // canvas.toBlob is "callback" style, so we wrap it in a Promise.
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not compress photo'))),
      'image/jpeg',
      QUALITY
    );
  });
}

// ---- Converting between Blobs and text (for the JSON backup file) ----
// A JSON file can only hold text, so photos are turned into "base64" text
// (a way of writing any binary data using only letters and numbers).
// The result looks like "data:image/jpeg;base64,/9j/4AAQ..."

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(dataURL) {
  // fetch() understands data: URLs, which is a neat shortcut.
  const res = await fetch(dataURL);
  return res.blob();
}
