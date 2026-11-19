const VIDEO_EXT = /\.(mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|3gp|3g2|mts|m2ts|wmv|flv|ogv)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|svg|tiff?|raw|dng|cr2|nef|arw|orf|rw2)$/i;

/** Classifies a media item from its MIME type, file name and type hint. */
export function mediaKind(item) {
  const mime = String(item.mimeType || "").trim().toLowerCase();
  const name = String(item.filename || item.name || "").trim().toLowerCase();
  const kind = String(item.type || "").trim().toLowerCase();
  const isVideo = mime.startsWith("video/") || VIDEO_EXT.test(name) || kind === "video";
  const isImage = mime.startsWith("image/") || IMAGE_EXT.test(name) || ["photo", "image", "screenshot"].includes(kind);
  const isScreenshot = kind === "screenshot" || /screenshot|screen[ _-]?shot/i.test(name);
  return { isVideo, isImage, isScreenshot, isDriveFile: !isVideo && !isImage };
}

/** Small least-recently-used cache (Map keeps insertion order). */
export function createLru(limit = 200, onEvict = () => {}) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        onEvict(oldest, map.get(oldest));
        map.delete(oldest);
      }
    },
    get size() { return map.size; },
  };
}
