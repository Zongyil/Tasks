/**
 * Web Worker for Data Compression, Decompression, and Sync Processing.
 * Offloads CPU-heavy fflate zlib level 9 compression, base64 encoding/decoding,
 * and JSON stringify/parse from the Renderer UI main thread.
 */

// Try loading fflate script in Web Worker context
try {
  importScripts('assets/fflate.min.js');
} catch (e) {
  console.warn('SyncWorker: importScripts fflate failed:', e);
}

function uint8ToBase64(u8Arr) {
  const CHUNK_SIZE = 0x8000;
  let index = 0;
  const length = u8Arr.length;
  let result = '';
  while (index < length) {
    const slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
    result += String.fromCharCode.apply(null, slice);
    index += CHUNK_SIZE;
  }
  return btoa(result);
}

function base64ToUint8(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

self.onmessage = function (e) {
  const { taskId, action, payload } = e.data;

  try {
    let result = null;

    switch (action) {
      case 'compress_sync_code': {
        const jsonString = JSON.stringify(payload);
        if (typeof fflate !== 'undefined' && fflate.zlibSync && fflate.strToU8) {
          const compressedBytes = fflate.zlibSync(fflate.strToU8(jsonString), { level: 9 });
          const encoded = "FFL|" + uint8ToBase64(compressedBytes);
          result = { encoded, length: encoded.length };
        } else {
          // Fallback if fflate not loaded
          const encoded = "RAW|" + btoa(encodeURIComponent(jsonString));
          result = { encoded, length: encoded.length };
        }
        break;
      }

      case 'decompress_sync_code': {
        const code = payload.code || '';
        let jsonString = null;

        if (code.startsWith("FFL|")) {
          const compressedBytes = base64ToUint8(code.substring(4));
          if (typeof fflate !== 'undefined' && fflate.unzlibSync && fflate.strFromU8) {
            jsonString = fflate.strFromU8(fflate.unzlibSync(compressedBytes));
          }
        } else if (code.startsWith("RAW|")) {
          jsonString = decodeURIComponent(atob(code.substring(4)));
        } else {
          // Attempt default fflate unzlib
          try {
            const compressedBytes = base64ToUint8(code);
            if (typeof fflate !== 'undefined' && fflate.unzlibSync && fflate.strFromU8) {
              jsonString = fflate.strFromU8(fflate.unzlibSync(compressedBytes));
            }
          } catch (_) {
            jsonString = decodeURIComponent(escape(atob(code)));
          }
        }

        if (!jsonString) {
          throw new Error('无法解析该同步码, 格式可能已损坏或复制不完整');
        }

        const data = JSON.parse(jsonString);
        result = { data };
        break;
      }

      default:
        throw new Error(`Unknown sync worker action: ${action}`);
    }

    self.postMessage({ taskId, success: true, result });
  } catch (err) {
    self.postMessage({ taskId, success: false, error: err.message || String(err) });
  }
};
