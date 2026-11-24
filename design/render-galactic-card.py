# -*- coding: utf-8 -*-
"""МАКЕТ: карточка «Галактический гиперпрыжок» на карте (§133.14).

Два состояния одной карточки — до нажатия и во время отсчёта. Палитра
обычная (не «сверхновая»), потому что карточка живёт в обычной игре.

Запуск: `python3 design/render-galactic-card.py`
"""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W, H = 460, 440
S = 2

P = dict(
    bg="#0f1514", surface="#151d1c", text="#dde4e2", variant="#a9b4b1",
    outline="#3b4a48", primary="#4fd8c4", on_primary="#003730",
    container="#00504a", on_container="#70f5df", warn="#ffd37a", dim="#7d8a87",
)


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size * S)


def card(d, box, radius=16, outline="#3b4a48"):
    d.rounded_rectangle([c * S for c in box], radius=radius * S,
                        fill=P["surface"], outline=outline, width=2 * S)


def pill(d, box, text, fg, bg, size=13, border=None):
    d.rounded_rectangle([c * S for c in box], fill=bg,
                        outline=border, width=2 * S if border else 0, radius=999)
    f = font(size, True)
    tw = d.textlength(text, font=f)
    d.text(((box[0] + box[2]) / 2 * S - tw / 2, (box[1] + box[3]) / 2 * S), text,
           font=f, fill=fg, anchor="lm")


def galactic(d, y, armed):
    card(d, (12, y, W - 12, y + 186))
    d.text((28 * S, (y + 26) * S), "Галактический гиперпрыжок", font=font(17, True),
           fill=P["text"], anchor="lm")
    d.text((28 * S, (y + 50) * S), "Прибытие: точка (96, 96) → ближайшая система",
           font=font(11), fill=P["variant"], anchor="lm")
    d.text((28 * S, (y + 67) * S), "Riedquat в галактике 3. Двигатель одноразовый,",
           font=font(11), fill=P["variant"], anchor="lm")
    d.text((28 * S, (y + 84) * S), "криминальное дозье будет сброшено.",
           font=font(11), fill=P["variant"], anchor="lm")

    if armed:
        pill(d, (26, y + 104, 146, y + 136), "Отменить", P["on_container"], P["container"])
        f = font(20, True)
        tw = d.textlength("9.3 с", font=f)
        d.text((W - 28, (y + 120) * S), "9.3 с", font=f, fill=P["warn"], anchor="rm")
        hint = "Отсчёт идёт на ваших глазах: нажмите «Отменить», пока горит таймер, —"
        hint2 = "и останетесь здесь."
    else:
        pill(d, (26, y + 104, 146, y + 136), "Активировать", P["on_primary"], P["primary"])
        hint = "Прыжок начнётся через 10 секунд после нажатия — этого хватает,"
        hint2 = "чтобы передумать."
    d.text((28 * S, (y + 156) * S), hint, font=font(10), fill=P["dim"], anchor="lm")
    d.text((28 * S, (y + 172) * S), hint2, font=font(10), fill=P["dim"], anchor="lm")


img = Image.new("RGB", (W * S, H * S), P["bg"])
d = ImageDraw.Draw(img)
d.text((16 * S, 22 * S), "3 420 CR", font=font(13, True), fill=P["text"], anchor="lm")
d.text((W - 16 * S, 22 * S), "6.0 / 7.0 св. г.", font=font(13, True), fill=P["warn"], anchor="rm")

galactic(d, 48, False)
galactic(d, 250, True)

img.save("/home/user/elite-idle/design/galactic-card.png")
print("ok")
