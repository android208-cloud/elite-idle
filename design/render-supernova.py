# -*- coding: utf-8 -*-
"""МАКЕТ: «Рынок» во время «Сверхновой» в красной палитре.

Три варианта одного экрана, чтобы выбрать насыщенность:

  a — тёплые тёмные поверхности, красный акцент (основной кандидат);
  b — всё залито красным, включая фон;
  c — поверхности остаются нынешними, красными только акценты.

Запуск: `python3 design/render-supernova.py` (нужен Pillow).

Рисуем не «картинку на тему», а макет настоящего экрана: те же карточки,
те же подписи, что в игре. Два варианта насыщенности.
"""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W, H = 460, 900
S = 2  # рисуем в двойном размере — картинка остаётся резкой


def pal(kind):
    if kind == "a":  # тёплые тёмные поверхности, красный акцент
        return dict(
            bg="#140f0e", surface="#1d1514", surface2="#251a18", surface3="#2d211f",
            text="#e4dcda", variant="#b5a7a3", outline="#4a3936",
            primary="#ff6a58", on_primary="#3a0f08", container="#55150f",
            on_container="#ffb9ad", good="#8fbf7a", bad="#ff8a80", warn="#ffc67a",
            band="#8f1f16", band_text="#ffd9d3", card_outline="#5b2a24",
        )
    if kind == "d":  # выбранный вариант: красные поверхности на чёрном фоне
        return dict(
            bg="#000000", surface="#2a1210", surface2="#361815", surface3="#41201b",
            text="#ffe3df", variant="#e0b7b0", outline="#6b332c",
            primary="#ff7a63", on_primary="#2a0b07", container="#6d1b12",
            on_container="#ffd0c7", good="#a8cc8a", bad="#ff9c8f", warn="#ffcf8a",
            band="#b3261e", band_text="#fff0ec", card_outline="#6b332c",
        )
    if kind == "c":  # акценты красные, поверхности — как сейчас
        return dict(
            bg="#0f1514", surface="#151d1c", surface2="#1c2625", surface3="#232f2e",
            text="#dde4e2", variant="#a9b4b1", outline="#3b4a48",
            primary="#ff6a58", on_primary="#3a0f08", container="#55150f",
            on_container="#ffb9ad", good="#7ddc8f", bad="#ff8a80", warn="#ffd37a",
            band="#8f1f16", band_text="#ffd9d3", card_outline="#3b4a48",
        )
    # «b» — всё залито красным
    return dict(
        bg="#2a0f0d", surface="#361512", surface2="#421a16", surface3="#4d1f1a",
        text="#ffe3df", variant="#e0b7b0", outline="#6b332c",
        primary="#ff7a63", on_primary="#2a0b07", container="#6d1b12",
        on_container="#ffd0c7", good="#a8cc8a", bad="#ff9c8f", warn="#ffcf8a",
        band="#c22a1c", band_text="#fff0ec", card_outline="#7a3a31",
    )


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size * S)


def card(d, box, p, fill=None, outline=None, width=2, radius=16):
    d.rounded_rectangle([c * S for c in box], radius=radius * S,
                        fill=fill or p["surface"], outline=outline, width=width * S)


def pill(d, box, p, text, fg, bg, border=None, size=13):
    d.rounded_rectangle([c * S for c in box], radius=999, fill=bg,
                        outline=border, width=2 * S if border else 0)
    f = font(size, True)
    tw = d.textlength(text, font=f)
    d.text(((box[0] + box[2]) / 2 * S - tw / 2, (box[1] + box[3]) / 2 * S), text,
           font=f, fill=fg, anchor="lm")


def screen(kind):
    p = pal(kind)
    img = Image.new("RGB", (W * S, H * S), p["bg"])
    d = ImageDraw.Draw(img)

    # --- шапка с деньгами ---
    d.text((16 * S, 22 * S), "3 420 CR", font=font(13, True), fill=p["text"], anchor="lm")
    d.text((W - 16 * S, 22 * S), "6.0 / 7.0 св. г.", font=font(13, True), fill=p["warn"], anchor="rm")

    # --- красная полоса события ---
    y = 44
    d.rounded_rectangle([12 * S, y * S, (W - 12) * S, (y + 46) * S], radius=14 * S, fill=p["band"])
    d.text((26 * S, (y + 15) * S), "СВЕРХНОВА", font=font(14, True), fill=p["band_text"], anchor="lm")
    d.text((26 * S, (y + 33) * S), "утечка топлива · до взрыва 2.4 игр. ч",
           font=font(12), fill=p["band_text"], anchor="lm")

    # --- карточка станции ---
    y = 104
    card(d, (12, y, W - 12, y + 176), p, outline=p["card_outline"], width=2)
    d.text((28 * S, (y + 26) * S), "Станция MAISSO", font=font(18, True), fill=p["text"], anchor="lm")
    d.text((28 * S, (y + 52) * S), "Трюм 4 из 20 т · Свободно: 16 т",
           font=font(12), fill=p["variant"], anchor="lm")
    # полоска трюма
    d.rounded_rectangle([28 * S, (y + 68) * S, (W - 28) * S, (y + 76) * S], radius=4 * S, fill=p["surface3"])
    d.rounded_rectangle([28 * S, (y + 68) * S, (28 + 0.2 * (W - 56)) * S, (y + 76) * S], radius=4 * S, fill=p["primary"])
    d.text((28 * S, (y + 96) * S), "Сверхновая: станция торгует только беженцами",
           font=font(12), fill=p["bad"], anchor="lm")
    d.text((28 * S, (y + 116) * S), "Нет топлива на прыжок — уходите в другую",
           font=font(11), fill=p["variant"], anchor="lm")
    d.text((28 * S, (y + 132) * S), "галактику, но награды не будет.",
           font=font(11), fill=p["variant"], anchor="lm")
    pill(d, (26, y + 146, 132, y + 168), p, "--", p["variant"], p["surface2"], border=p["outline"])
    pill(d, (W - 148, y + 146, W - 26, y + 168), p, "Контракты", p["variant"], p["surface2"], border=p["outline"])

    # --- карточка «Беженцы» ---
    y = 296
    card(d, (12, y, W - 12, y + 108), p, outline=p["primary"], width=2)
    d.text((28 * S, (y + 26) * S), "Беженцы", font=font(16, True), fill=p["text"], anchor="lm")
    d.text((28 * S, (y + 50) * S), "В наличии: 200 т · На борту: 0 т · Свободно: 16 т",
           font=font(11), fill=p["variant"], anchor="lm")
    d.text((W - 28 * S, (y + 26) * S), "0.0 CR", font=font(15, True), fill=p["primary"], anchor="rm")
    pill(d, (W - 106, y + 68, W - 26, y + 96), p, "Макс.", p["on_primary"], p["primary"])

    # --- карточки товара из трюма ---
    for name, tons in (("Еда", 4), ("Медикаменты", 2)):
        y += 0 if name == "Еда" else 92
        if name == "Еда":
            y = 420
        card(d, (12, y, W - 12, y + 84), p)
        d.text((28 * S, (y + 24) * S), name, font=font(15, True), fill=p["text"], anchor="lm")
        d.text((28 * S, (y + 46) * S), f"В трюме: {tons} т", font=font(11), fill=p["variant"], anchor="lm")
        pill(d, (W - 168, y + 48, W - 26, y + 76), p, "Оставить всё", p["variant"], p["surface2"], border=p["outline"])

    # --- нижние вкладки ---
    ty = H - 56
    d.line([0, ty * S, W * S, ty * S], fill=p["outline"], width=1 * S)
    tabs = ["Корабль", "Карта", "Рынок", "Ангар", "Журнал"]
    step = (W - 24) / len(tabs)
    for i, t in enumerate(tabs):
        cx = 12 + step * (i + 0.5)
        active = t == "Рынок"
        d.text((cx * S, (ty + 28) * S), t, font=font(11, active),
               fill=p["primary"] if active else p["variant"], anchor="mm")
    return img


for kind in ("a", "b", "c", "d"):
    screen(kind).save(f"/home/user/elite-idle/design/supernova-red-{kind}.png")
print("ok")
