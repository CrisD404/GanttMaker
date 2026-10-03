// Genera los íconos PNG de la app (para instalarla como PWA) sin dependencias externas:
// un rasterizador mínimo con antialiasing por supermuestreo y un codificador PNG.
import { deflateSync } from 'node:zlib';

// --- PNG -----------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro "none"
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Rasterizado del logo ------------------------------------------------------

/** Distancia con signo a un rectángulo redondeado (negativa adentro). */
function sdRoundRect(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const cx = x + w / 2, cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const C1 = [0x6d, 0x6d, 0xff];
const C2 = [0xa8, 0x55, 0xf7];
/** Barras del logo en un cuadro de 16×16 (las mismas del favicon SVG). */
const BARS = [
  { x: 1, y: 2, w: 9, h: 3, a: 1 },
  { x: 4, y: 6.5, w: 10, h: 3, a: 0.85 },
  { x: 2.5, y: 11, w: 7, h: 3, a: 0.7 },
];

/**
 * @param size  lado en píxeles
 * @param maskable  fondo a sangre (sin esquinas transparentes) y logo dentro de la zona segura
 */
export function renderIcon(size: number, maskable = false): Buffer {
  const out = new Uint8Array(size * size * 4);
  const SS = 4; // supermuestreo 4×4
  const radius = maskable ? 0 : size * 0.22;
  const logo = size * (maskable ? 0.5 : 0.58);
  const ox = (size - logo) / 2, oy = (size - logo) / 2;
  const unit = logo / 16;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgCov = 0, white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
          if (sdRoundRect(x, y, 0, 0, size, size, radius) > 0) continue;
          bgCov++;
          for (const b of BARS) {
            if (sdRoundRect(x, y, ox + b.x * unit, oy + b.y * unit, b.w * unit, b.h * unit, 1.5 * unit) <= 0) {
              white += b.a;
              break;
            }
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (!bgCov) continue;
      const t = (px + py) / (2 * size); // degradé diagonal
      const w = white / bgCov;
      for (let c = 0; c < 3; c++) {
        const bg = C1[c] + (C2[c] - C1[c]) * t;
        out[i + c] = Math.round(bg + (255 - bg) * w);
      }
      out[i + 3] = Math.round((bgCov / n) * 255);
    }
  }
  return encodePng(size, size, out);
}

export function buildIcons(): Record<string, Buffer> {
  return {
    'icons/icon-192.png': renderIcon(192),
    'icons/icon-512.png': renderIcon(512),
    'icons/maskable-512.png': renderIcon(512, true),
    'icons/apple-touch-icon.png': renderIcon(180, true),
  };
}
