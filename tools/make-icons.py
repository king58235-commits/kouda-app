"""產生 PWA 圖示（純 Python，不需要額外套件）。用法：python tools/make-icons.py
畫面是一個綠底、白色餐盤＋一道缺口的圓環（像「還剩多少」的額度環）。"""
import math
import struct
import zlib
from pathlib import Path

GREEN = (63, 115, 87, 255)  # 與 app.css 的 --accent-fill（#3f7357）一致
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(data)


def glyph(x, y, size, scale):
    """白色額度環＋中心圓點。scale 控制圖形大小（maskable 要縮小留安全邊）。"""
    cx = cy = (size - 1) / 2
    r = math.hypot(x - cx, y - cy) / size
    ang = (math.degrees(math.atan2(y - cy, x - cx)) + 90) % 360
    ring = 0.30 * scale <= r <= 0.40 * scale
    gap = 300 <= ang <= 340
    dot = r <= 0.10 * scale
    return (ring and not gap) or dot


def any_icon(x, y, size):
    # 圓角方形底（圓角半徑約 22%）
    rad = size * 0.22
    cx = min(max(x, rad), size - 1 - rad)
    cy = min(max(y, rad), size - 1 - rad)
    if math.hypot(x - cx, y - cy) > rad:
        return CLEAR
    return WHITE if glyph(x, y, size, 1.0) else GREEN


def maskable_icon(x, y, size):
    return WHITE if glyph(x, y, size, 0.8) else GREEN


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "app" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    png(out / "icon-192.png", 192, any_icon)
    png(out / "icon-512.png", 512, any_icon)
    png(out / "icon-maskable-512.png", 512, maskable_icon)
    png(out / "apple-touch-icon.png", 180, maskable_icon)
    print("icons written to", out)
