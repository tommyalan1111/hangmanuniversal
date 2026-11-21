"""Build the web assets the Hangman Universal site needs.

Source of truth:
  ../../store/play-icon-512.png        app icon
  ../../.shots/01-home.png             home screen
  ../../.shots/02-play.png             game screen

Outputs (public/):
  icon.png, apple-touch-icon.png, og.jpg,
  screenshots/home.webp, play.webp

Run: python tools/make-assets.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent
OUT = ROOT / "public"
SHOTS = OUT / "screenshots"

FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_SEMI = "C:/Windows/Fonts/seguisb.ttf"
FONT_REG = "C:/Windows/Fonts/segoeui.ttf"

AMBER = (255, 194, 71)
INK = (244, 246, 255)
MUTED = (150, 163, 196)


def rounded_icon(src: Path, size: int = 512, radius: int = 0) -> Image.Image:
    icon = Image.open(src).convert("RGBA").resize((size, size), Image.LANCZOS)
    if radius:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
        icon.putalpha(mask)
    return icon


def save_icon() -> None:
    icon = rounded_icon(SRC / "store" / "play-icon-512.png")
    icon.save(OUT / "icon.png", optimize=True)
    icon.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)


def save_shots() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    pairs = [
        ("01-home.png", "home.webp"),
        ("02-play.png", "play.webp"),
    ]
    for src_name, dst_name in pairs:
        img = Image.open(SRC / ".shots" / src_name).convert("RGB")
        if img.width > 780:
            img = img.resize((780, round(img.height * 780 / img.width)), Image.LANCZOS)
        img.save(SHOTS / dst_name, "WEBP", quality=82, method=6)


def radial(size: tuple[int, int], centre: tuple[float, float], radius: float, colour: tuple[int, int, int], peak: float) -> Image.Image:
    """Soft radial glow as an RGBA layer."""
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 64
    for i in range(steps, 0, -1):
        r = radius * i / steps
        alpha = int(255 * peak * (1 - i / steps) ** 2)
        draw.ellipse(
            [centre[0] - r, centre[1] - r, centre[0] + r, centre[1] + r],
            fill=colour + (alpha,),
        )
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.12))


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, font: ImageFont.FreeTypeFont, fill, tracking: float) -> float:
    """Draw letter-spaced text; returns the end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


def tracked_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, tracking: float) -> float:
    return sum(draw.textlength(ch, font=font) for ch in text) + tracking * max(0, len(text) - 1)


def save_og() -> None:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), (7, 11, 22))
    img = Image.alpha_composite(img.convert("RGBA"), radial((w, h), (170, 60), 520, (255, 160, 40), 0.30))
    img = Image.alpha_composite(img, radial((w, h), (1080, 600), 480, (70, 180, 255), 0.20))

    # faint grid
    grid = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(grid)
    for x in range(0, w, 46):
        g.line([(x, 0), (x, h)], fill=(255, 255, 255, 9))
    for y in range(0, h, 46):
        g.line([(0, y), (w, y)], fill=(255, 255, 255, 9))
    img = Image.alpha_composite(img, grid)

    draw = ImageDraw.Draw(img)
    icon = rounded_icon(SRC / "store" / "play-icon-512.png", 164, 38)
    # soft shadow behind the icon
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([92, 236, 92 + 164, 236 + 164], 36, fill=(0, 0, 0, 160))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(22)))
    img.paste(icon, (92, 236), icon)
    draw = ImageDraw.Draw(img)

    x = 310
    title_font = ImageFont.truetype(FONT_BOLD, 92)
    sub_font = ImageFont.truetype(FONT_SEMI, 27)
    body_font = ImageFont.truetype(FONT_REG, 27)
    small_font = ImageFont.truetype(FONT_SEMI, 20)

    draw.text((x, 220), "HANGMAN", font=title_font, fill=AMBER)
    tracked(draw, (x + 5, 330), "UNIVERSAL", sub_font, INK, 11)
    draw.line([(x + 5, 386), (x + 70, 386)], fill=AMBER, width=3)
    draw.text((x + 5, 414), "21 topics  ·  14,351 clues  ·  six lives", font=body_font, fill=MUTED)

    tracked(draw, (x + 5, 488), "A WORD GAME FOR ANDROID", small_font, AMBER, 3.2)

    # corner brackets, arcade framing
    b = 34
    for cx, cy, dx, dy in [(40, 40, 1, 1), (w - 40, 40, -1, 1), (40, h - 40, 1, -1), (w - 40, h - 40, -1, -1)]:
        draw.line([(cx, cy), (cx + dx * b, cy)], fill=(255, 194, 71, 120), width=2)
        draw.line([(cx, cy), (cx, cy + dy * b)], fill=(255, 194, 71, 120), width=2)

    img.convert("RGB").save(OUT / "og.jpg", "JPEG", quality=88, optimize=True, progressive=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    save_icon()
    save_shots()
    save_og()
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.suffix in {".png", ".jpg", ".webp"}:
            print(f"{p.relative_to(OUT)}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

