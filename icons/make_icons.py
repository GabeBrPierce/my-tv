"""
Generates the two KaiOS launcher icon sizes (56x56 and 112x112) as flat,
non-transparent 24-bit PNGs, per KaiOS design guidance (solid colors, no
gradients/transparency, minimal flair). Draws directly with Pillow so there's
no SVG-rasterizer dependency.

Run: python3 make_icons.py
"""

from PIL import Image, ImageDraw

BG = (27, 39, 51)      # #1b2733
FG = (79, 195, 247)    # #4fc3f7


def draw_icon(size):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    s = size / 112.0  # scale factor from the 112px design grid

    def r(coords):
        return [c * s for c in coords]

    # TV screen body
    draw.rounded_rectangle(r([18, 30, 94, 78]), radius=6 * s, fill=FG)
    # Screen inset (background-colored, so it reads as a hollow screen)
    draw.rounded_rectangle(r([26, 38, 86, 70]), radius=2 * s, fill=BG)
    # Stand
    draw.rectangle(r([48, 80, 64, 88]), fill=FG)
    draw.rounded_rectangle(r([38, 90, 74, 96]), radius=3 * s, fill=FG)
    # Antennas
    draw.line(r([40, 30, 30, 16]), fill=FG, width=max(1, round(4 * s)))
    draw.line(r([72, 30, 82, 16]), fill=FG, width=max(1, round(4 * s)))
    # Play triangle inside the screen
    draw.polygon(r([50, 48, 50, 60, 62, 54]), fill=FG)

    return img


for size, name in [(56, "icon-56.png"), (112, "icon-112.png")]:
    icon = draw_icon(size)
    icon.save(name, "PNG")
    print(f"wrote {name} ({size}x{size}, mode={icon.mode})")
