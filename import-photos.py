# Photo importer: iPhone album -> places/photos/*.webp + places.json.
#
# Drop photos into the inbox folder (OneDrive syncs them off the phone), then:
#
#     py -3 import-photos.py            # or --dry-run to see the matches first
#
# Each photo is matched to a place by its EXIF GPS, falling back to the file
# name and then to MANUAL below. HEIC, JPEG and PNG all go in; small webp comes
# out. Originals are never touched, and photos already imported are skipped, so
# the command is safe to run again whenever the album grows.

import json, math, re, sys, unicodedata
from pathlib import Path

INBOX = Path(r"C:\Users\joelj\OneDrive\Places photos")
ROOT = Path(__file__).parent
PHOTOS = ROOT / "places" / "photos"
PLACES = ROOT / "places" / "places.json"
LEDGER = ROOT / "import-ledger.json"  # source file -> webp, so reruns skip it

# Photographs whose GPS is missing or wrong, placed by hand.
MANUAL = {
    "IMG_0279.JPG": "Monaco",
    "IMG_0291.PNG": "Nice",
    "IMG_0846.JPG": "Makarska",
    "IMG_2416.jpeg": "Chania",
    "IMG_2545.jpeg": "Athens",
    "IMG_2670.JPG": "Pula",
    "IMG_4243.jpeg": "Hyrynsalmi",
    "IMG_8319.jpeg": "Merzouga",
}

MAX_EDGE = 1600      # long edge in pixels
QUALITY = 82
MAX_PER_PLACE = 3    # the panel shows at most three frames
MATCH_KM = 75        # how far a photo may sit from a place centre
CROP = (4, 3)        # the panel frames are 4:3 and crop to fill either way
TONE = "warm"        # "colour", "grey", or "warm" (monochrome toned to the ink)

GROUND = (10, 9, 8)          # --ground, the black point of the warm tone
INK = (232, 207, 160)        # --ink, the white point

from PIL import Image, ImageOps
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    print("note: pillow-heif missing, HEIC files will be skipped\n")


def crop_to(image, ratio):
    """Centre-crop to an aspect ratio, taking the cut off the long side."""
    width, height = image.size
    target = ratio[0] / ratio[1]
    if width / height > target:
        keep = round(height * target)
        left = (width - keep) // 2
        return image.crop((left, 0, left + keep, height))
    keep = round(width / target)
    top = (height - keep) // 2
    return image.crop((0, top, width, top + keep))


def tone(image, mode):
    """Colour, plain black and white, or black and white toned to the page."""
    if mode == "colour":
        return image.convert("RGB")
    grey = ImageOps.grayscale(image)
    if mode == "grey":
        return grey.convert("RGB")
    return ImageOps.colorize(grey, GROUND, INK).convert("RGB")


def slug(name):
    flat = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", flat.lower()).strip("-")


def gps(image):
    """Latitude and longitude out of the EXIF block, or None."""
    exif = image.getexif()
    tags = exif.get_ifd(0x8825) if exif else None          # GPSInfo
    if not tags or 2 not in tags or 4 not in tags:
        return None

    def degrees(triple):
        d, m, s = (float(v) for v in triple)
        return d + m / 60 + s / 3600

    lat = degrees(tags[2])
    lon = degrees(tags[4])
    if str(tags.get(1, "N")).upper().startswith("S"):
        lat = -lat
    if str(tags.get(3, "E")).upper().startswith("W"):
        lon = -lon
    return lat, lon


def distance_km(lat1, lon1, lat2, lon2):
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest(places, lat, lon):
    best, best_km = None, MATCH_KM
    for place in places:
        km = distance_km(lat, lon, place["lat"], place["lon"])
        if km < best_km:
            best, best_km = place, km
    return best, best_km


def by_name(places, filename):
    """"kyoto-temple.heic" -> Kyoto. Longest name wins, so Koh Phangan beats Koh."""
    stem = slug(Path(filename).stem)
    hits = [p for p in places if slug(p["name"]) in stem]
    return max(hits, key=lambda p: len(p["name"])) if hits else None


def write_places(places):
    lines = [json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in places]
    PLACES.write_text("[\n  " + ",\n  ".join(lines) + "\n]\n", encoding="utf-8")


def main():
    dry = "--dry-run" in sys.argv
    if not INBOX.is_dir():
        sys.exit(f"inbox not found: {INBOX}")

    places = json.loads(PLACES.read_text(encoding="utf-8"))
    PHOTOS.mkdir(parents=True, exist_ok=True)
    ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else {}

    files = sorted(
        f for f in INBOX.rglob("*")
        if f.is_file() and f.suffix.lower() in {".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp"}
    )
    if not files:
        sys.exit(f"no photos in {INBOX}")

    unmatched, imported, skipped = [], 0, 0

    for path in files:
        if path.name in ledger:
            skipped += 1
            continue

        try:
            image = Image.open(path)
        except Exception as error:
            unmatched.append((path.name, f"unreadable ({error})"))
            continue

        place, how = None, ""
        if path.name in MANUAL:
            wanted = MANUAL[path.name]
            place = next((p for p in places if p["name"] == wanted), None)
            how = "by hand"
            if not place:
                unmatched.append((path.name, f"{wanted} is not in places.json yet"))
                continue
        else:
            point = gps(image)
            if point:
                place, km = nearest(places, *point)
                how = f"GPS, {km:.0f} km" if place else ""
                if not place:
                    unmatched.append((path.name, f"GPS {point[0]:.3f}, {point[1]:.3f} is far from every place"))
                    continue
            else:
                place = by_name(places, path.name)
                how = "file name"
                if not place:
                    unmatched.append((path.name, "no GPS and the name matches no place"))
                    continue

        if len(place["photos"]) >= MAX_PER_PLACE:
            unmatched.append((path.name, f"{place['name']} already has {MAX_PER_PLACE} photos"))
            continue

        stem = slug(place["name"])
        target = PHOTOS / f"{stem}-{len(place['photos']) + 1}.webp"

        if not dry:
            frame = tone(crop_to(ImageOps.exif_transpose(image), CROP), TONE)
            frame.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            frame.save(target, "WEBP", quality=QUALITY, method=6)

        place["photos"].append(f"photos/{target.name}")
        ledger[path.name] = target.name
        imported += 1
        print(f"{path.name:<32} -> {place['name']:<24} {target.name:<28} ({how})")

    if not dry:
        write_places(places)
        LEDGER.write_text(json.dumps(ledger, indent=2, sort_keys=True), encoding="utf-8")
    print(f"\n{imported} {'would be imported' if dry else 'imported'}, "
          f"{skipped} already in, {len(unmatched)} left over")
    for name, why in unmatched:
        print(f"  {name}: {why}")


if __name__ == "__main__":
    main()
