#!/usr/bin/env python3
"""
Generate Polymarket logo GIF icons for Ledger hardware wallet devices.

Downloads the official Polymarket logo and converts it to the required
GIF format at each device-specific size.

Ledger SDK requirements:
  - GIF format, NO transparency
  - Palette index 0 = black (background), index 1 = white (foreground)
  - 2-color palette for all sizes

Output files:
  icons/nanox_app_chain_1.gif   — 14x14
  icons/stax_app_chain_1.gif    — 32x32
  icons/flex_app_chain_1.gif    — 40x40
  icons/apex_app_chain_1.gif    — 32x32
  glyphs/chain_1_14px.gif       — 14x14
  glyphs/chain_1_48px.gif       — 48x48
  glyphs/chain_1_64px.gif       — 64x64
  glyphs/home_chain_1_14px.gif  — 14x14
"""

import os
import urllib.request
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
ICONS_DIR = os.path.join(REPO_DIR, "icons")
GLYPHS_DIR = os.path.join(REPO_DIR, "glyphs")

LOGO_URL = "https://polymarket.com/images/brand/icon-black.png"
LOGO_CACHE = os.path.join(SCRIPT_DIR, ".polymarket_logo_cache.png")


def download_logo() -> Image.Image:
    """Download the official Polymarket logo PNG (or use cached version)."""
    if not os.path.exists(LOGO_CACHE):
        print(f"  Downloading logo from {LOGO_URL}")
        urllib.request.urlretrieve(LOGO_URL, LOGO_CACHE)
    else:
        print(f"  Using cached logo: {LOGO_CACHE}")
    return Image.open(LOGO_CACHE)


def logo_to_ledger_gif(logo: Image.Image, size: int, output_path: str) -> None:
    """Convert the Polymarket logo to a Ledger-compatible GIF.

    The source logo is black shape on transparent background (RGBA).
    We invert it to white shape on black background for the Ledger screen.

    Steps:
      1. Extract alpha channel (shape mask)
      2. Resize to target size with high-quality resampling
      3. Threshold to pure black/white
      4. Save as 2-color palette GIF (index 0=black, index 1=white)
    """
    # Extract the alpha channel — this IS the logo shape
    alpha = logo.split()[3]  # RGBA -> A channel

    # Add padding (10% margin on each side) for better framing on device
    src_w, src_h = alpha.size
    margin = int(max(src_w, src_h) * 0.05)
    padded = Image.new("L", (src_w + 2 * margin, src_h + 2 * margin), 0)
    padded.paste(alpha, (margin, margin))

    # Resize with high-quality Lanczos resampling
    resized = padded.resize((size, size), Image.LANCZOS)

    # Create palette image: index 0 = black, index 1 = white
    img_p = Image.new("P", (size, size), 0)
    palette = [0, 0, 0, 255, 255, 255] + [0] * (256 * 3 - 6)
    img_p.putpalette(palette)

    # Threshold: alpha > 128 becomes white (index 1), rest stays black (index 0)
    px_in = resized.load()
    px_out = img_p.load()
    for y in range(size):
        for x in range(size):
            px_out[x, y] = 1 if px_in[x, y] > 128 else 0

    img_p.save(output_path, format="GIF")
    print(f"  Saved {size:2d}x{size:<2d} -> {output_path}")


def main() -> None:
    os.makedirs(ICONS_DIR, exist_ok=True)
    os.makedirs(GLYPHS_DIR, exist_ok=True)

    print("Generating Polymarket icons from official logo...")
    logo = download_logo()

    targets = [
        # (size, output_path)
        (14, os.path.join(ICONS_DIR, "nanox_app_chain_1.gif")),
        (32, os.path.join(ICONS_DIR, "stax_app_chain_1.gif")),
        (40, os.path.join(ICONS_DIR, "flex_app_chain_1.gif")),
        (32, os.path.join(ICONS_DIR, "apex_app_chain_1.gif")),
        (14, os.path.join(GLYPHS_DIR, "chain_1_14px.gif")),
        (48, os.path.join(GLYPHS_DIR, "chain_1_48px.gif")),
        (64, os.path.join(GLYPHS_DIR, "chain_1_64px.gif")),
        (14, os.path.join(GLYPHS_DIR, "home_chain_1_14px.gif")),
    ]

    for size, path in targets:
        logo_to_ledger_gif(logo, size, path)

    print("Done. All 8 icons generated.")


if __name__ == "__main__":
    main()
