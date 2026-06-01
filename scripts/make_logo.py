"""
Composite FairLine logo: icon + clean text overlay.
Run: python3 scripts/make_logo.py
Output: assets/logo_final.png (512x512, ready for DeepSurge)
"""
from PIL import Image, ImageDraw, ImageFont
import sys, os

ICON_PATH  = "assets/logo_icon.png"
OUT_PATH   = "assets/logo_final.png"
SIZE       = 512
BG_COLOR   = (13, 17, 23)      # #0d1117
BLUE       = (88, 166, 255)    # #58a6ff
WHITE      = (230, 237, 243)   # #e6edf3

img = Image.open(ICON_PATH).resize((SIZE, SIZE), Image.LANCZOS).convert("RGBA")

# Dark overlay on bottom third for text legibility
overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw_o  = ImageDraw.Draw(overlay)
draw_o.rectangle([(0, SIZE*2//3), (SIZE, SIZE)], fill=(13, 17, 23, 200))
img = Image.alpha_composite(img, overlay)

draw = ImageDraw.Draw(img)

# Try system fonts, fall back gracefully
def get_font(size):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try: return ImageFont.truetype(path, size)
            except: pass
    return ImageFont.load_default()

# "Fair" in white, "Line" in blue — split rendering for color accent
font_big  = get_font(72)
font_sub  = get_font(20)

# Measure combined text width
text = "FairLine"
bbox = draw.textbbox((0, 0), text, font=font_big)
tw   = bbox[2] - bbox[0]
tx   = (SIZE - tw) // 2
ty   = SIZE - 100

# Draw "Fair" white, "Line" blue
fair_bbox = draw.textbbox((0, 0), "Fair", font=font_big)
fair_w    = fair_bbox[2] - fair_bbox[0]
draw.text((tx, ty),          "Fair", font=font_big, fill=WHITE)
draw.text((tx + fair_w, ty), "Line", font=font_big, fill=BLUE)

# Tagline
tag = "DeepBook Predict Vault"
tag_bbox = draw.textbbox((0,0), tag, font=font_sub)
tag_w    = tag_bbox[2] - tag_bbox[0]
draw.text(((SIZE - tag_w)//2, ty + 78), tag, font=font_sub, fill=(139, 148, 158))

# Save as RGB PNG
final = Image.new("RGB", (SIZE, SIZE), BG_COLOR)
final.paste(img, mask=img.split()[3])
final.save(OUT_PATH, "PNG")
print(f"Saved → {OUT_PATH}")
