#!/usr/bin/env python3
"""
Generate Polymarket logo GIF icons for Ledger hardware wallet devices.

Polymarket logo: stylized "P" glyph — white shape on black background.

Output files:
  icons/nanox_app_chain_1.gif   — 14x14  (1-bit, monochrome)
  icons/stax_app_chain_1.gif    — 32x32  (grayscale)
  icons/flex_app_chain_1.gif    — 40x40  (grayscale)
  icons/apex_app_chain_1.gif    — 32x32  (grayscale)
  glyphs/chain_1_14px.gif       — 14x14  (1-bit, monochrome)
  glyphs/chain_1_48px.gif       — 48x48  (grayscale)
  glyphs/chain_1_64px.gif       — 64x64  (grayscale)
  glyphs/home_chain_1_14px.gif  — 14x14  (1-bit, monochrome)
"""

import os
from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
ICONS_DIR = os.path.join(REPO_DIR, "icons")
GLYPHS_DIR = os.path.join(REPO_DIR, "glyphs")


def draw_p_logo(draw: ImageDraw.ImageDraw, size: int, fg: int = 255, bg: int = 0) -> None:
    """
    Draw a stylized Polymarket "P" glyph onto the given ImageDraw context.

    The "P" is constructed from:
      - A vertical stem on the left side
      - A rounded bowl on the upper-right half

    All coordinates are expressed as fractions of `size` so the glyph scales
    cleanly to any resolution.
    """
    s = size

    # Margins as fractions of size
    left   = round(s * 0.15)
    right  = round(s * 0.85)
    top    = round(s * 0.08)
    bottom = round(s * 0.92)

    stem_w  = max(1, round(s * 0.18))   # width of the vertical stem
    bowl_h  = round((bottom - top) * 0.52)  # bowl occupies top ~52% of height

    # --- Vertical stem (full height) ---
    draw.rectangle(
        [left, top, left + stem_w - 1, bottom],
        fill=fg,
    )

    # --- Bowl (rounded rectangle on the right side of the upper half) ---
    bowl_left   = left + stem_w
    bowl_right  = right
    bowl_top    = top
    bowl_bottom = top + bowl_h

    bowl_width  = bowl_right - bowl_left
    bowl_height = bowl_bottom - bowl_top

    if size <= 14:
        # At tiny sizes draw a plain rectangle to keep pixels crisp
        draw.rectangle(
            [bowl_left, bowl_top, bowl_right - 1, bowl_bottom - 1],
            fill=fg,
        )
    else:
        # Larger sizes: use an ellipse for the bowl rounded cap
        # Full enclosed bowl shape: rectangle + semicircle on the right
        # Draw as a rounded rectangle (pieslice approach)
        radius = bowl_height // 2

        # Left part of bowl (rectangle up to midpoint)
        mid_x = bowl_left + bowl_width - radius
        draw.rectangle(
            [bowl_left, bowl_top, mid_x, bowl_bottom - 1],
            fill=fg,
        )
        # Right semicircle
        draw.ellipse(
            [mid_x - radius, bowl_top, mid_x + radius - 1, bowl_bottom - 1],
            fill=fg,
        )

    # --- Cut out the inside of the bowl (inner negative space) ---
    # Inner bowl inset
    inset = max(1, round(s * 0.08))
    inner_left   = bowl_left + inset
    inner_right  = bowl_right - inset
    inner_top    = bowl_top  + inset
    inner_bottom = bowl_bottom - inset

    if inner_right > inner_left and inner_bottom > inner_top:
        if size <= 14:
            draw.rectangle(
                [inner_left, inner_top, inner_right - 1, inner_bottom - 1],
                fill=bg,
            )
        else:
            i_width  = inner_right - inner_left
            i_height = inner_bottom - inner_top
            i_radius = i_height // 2
            i_mid_x  = inner_left + i_width - i_radius

            draw.rectangle(
                [inner_left, inner_top, i_mid_x, inner_bottom - 1],
                fill=bg,
            )
            draw.ellipse(
                [i_mid_x - i_radius, inner_top, i_mid_x + i_radius - 1, inner_bottom - 1],
                fill=bg,
            )


def make_gif_1bit(size: int, output_path: str) -> None:
    """Create a 1-bit (black & white) GIF89a — for Nano X/S+ monochrome screens."""
    img = Image.new("P", (size, size), 0)

    # Set up a minimal 2-colour palette: index 0 = black, index 1 = white
    palette = [0, 0, 0,   255, 255, 255] + [0] * (256 * 3 - 6)
    img.putpalette(palette)

    draw = ImageDraw.Draw(img)
    draw_p_logo(draw, size, fg=1, bg=0)

    # transparency kwarg forces GIF89a header (GIF87a has no transparency block)
    img.save(output_path, format="GIF", transparency=0)
    print(f"  Saved 1-bit  {size}x{size} -> {output_path}")


def make_gif_grayscale(size: int, output_path: str) -> None:
    """Create a grayscale GIF89a — for Stax / Flex / Apex colour screens."""
    # Draw in L mode first for clean rendering, then convert to P (palette)
    img_l = Image.new("L", (size, size), 0)
    draw  = ImageDraw.Draw(img_l)
    draw_p_logo(draw, size, fg=255, bg=0)

    # Convert to palette mode for GIF encoding
    img_p = img_l.convert("P")
    # transparency kwarg forces GIF89a header
    img_p.save(output_path, format="GIF", transparency=0)
    print(f"  Saved gray   {size}x{size} -> {output_path}")


def main() -> None:
    os.makedirs(ICONS_DIR,  exist_ok=True)
    os.makedirs(GLYPHS_DIR, exist_ok=True)

    print("Generating Polymarket 'P' logo icons...")

    # ---- App icons (per-device) ----
    make_gif_1bit    (14, os.path.join(ICONS_DIR, "nanox_app_chain_1.gif"))
    make_gif_grayscale(32, os.path.join(ICONS_DIR, "stax_app_chain_1.gif"))
    make_gif_grayscale(40, os.path.join(ICONS_DIR, "flex_app_chain_1.gif"))
    make_gif_grayscale(32, os.path.join(ICONS_DIR, "apex_app_chain_1.gif"))

    # ---- UI glyphs ----
    make_gif_1bit    (14, os.path.join(GLYPHS_DIR, "chain_1_14px.gif"))
    make_gif_grayscale(48, os.path.join(GLYPHS_DIR, "chain_1_48px.gif"))
    make_gif_grayscale(64, os.path.join(GLYPHS_DIR, "chain_1_64px.gif"))
    make_gif_1bit    (14, os.path.join(GLYPHS_DIR, "home_chain_1_14px.gif"))

    print("Done. All 8 icons generated.")


if __name__ == "__main__":
    main()
