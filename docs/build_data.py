"""Convert umm_kulthum_dataset.xlsx into web/data.js for the static node-map app.

Usage (needs only openpyxl):
    python3 web/build_data.py

It cleans the free-text spreadsheet into structured records:
  * parses coordinates (decimal, N/E suffix, or degrees-minutes-seconds)
  * normalises city / country
  * extracts the people and songs each place is linked to, using the alias
    tables below, so the app can draw relationship edges between places.
Edit PEOPLE / SONGS to add or fix entities, then re-run.
"""
import datetime
import json
import re
import unicodedata
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent
XLSX = ROOT.parent / "umm_kulthum_dataset.xlsx"
OUT = ROOT / "data.js"

# ---------------------------------------------------------------- entities
# canonical name, role, regex of aliases (matched on accent-stripped lowercase text)
PEOPLE = [
    ("Riad al-Sunbati", "composer", r"sunbati|sonbati"),
    ("Mohammad al-Qasabji", "composer", r"qasabji|qasabgi|kasabgi"),
    ("Zakariyya Ahmad", "composer", r"zakariy+a ahm"),
    ("Mohamed Abdel Wahab", "composer",
     r"(muhammad|mohamm?ed|mohamed) ['‘’]?abd?[ -]?(al|el)?-?wahh?ab(?! muhammad)|abdel-wahhab|abdel wahab(?! muhammad)"),
    ("Baligh Hamdi", "composer", r"baligh"),
    ("Mohamed El-Mougy", "composer", r"mougy|mogi\b"),
    ("Ahmad Ramy", "poet", r"ahm[ae]d ram[iy]"),
    ("Bayram al-Tunisi", "poet", r"bayram"),
    ("Ahmad Shawqi", "poet", r"ahm[ae]d shawq?[iy]|ahmed shawky"),
    ("Ibrahim Naji", "poet", r"ibrahim na[gj]i"),
    ("Ahmad Shafiq Kamil", "poet", r"shafiq kamil"),
    ("Mursi Jamil Aziz", "poet", r"m[ou]rsi"),
    ("Ma'mun al-Shinawi", "poet", r"ma.?mun al-?shinawi"),
    ("Abd al-Wahhab Muhammad", "poet", r"['‘’]?abd?[ -]?(al|el)?-?wahh?ab muhammad"),
    ("Abd al-Mun'im al-Suba'i", "poet", r"mun.?im al-?suba"),
    ("Jurj Jardaq", "poet", r"jardaq|jordac"),
    ("Hafiz Ibrahim", "poet", r"hafi[zd] ibrahim"),
    ("Nizar Qabbani", "poet", r"qabbani|kabbani"),
    ("Mahmoud Hassan Ismail", "poet", r"mahmoud hassan ismail"),
    ("Ahmed Fouad Negm", "poet", r"negm"),
    ("Aziz Abaza", "poet", r"aziz abaza"),
    ("Sheikh Ibrahim al-Baltagi (father)", "family",
     r"her father|sheikh ibrahim|shaykh ibr[aā]h[iī]m|father: sheikh|ibrahim al-baltagi|ibrahim el-beltagy|ibrahim el-sayed"),
    ("Sheikh Abu al-Ila Muhammad", "mentor", r"abu al-?.?[ie]la|abu alaa"),
    ("Hassan El-Hefnawi (husband)", "family", r"hassan el-hefnawi"),
    ("Gamal Abdel Nasser", "politics", r"nasser|nasir"),
    ("King Farouk I", "politics", r"king farou?q|king farouk|farouq i\b|farouk i\b"),
    ("Habib Bourguiba", "politics", r"bourguiba"),
    ("King Hassan II", "politics", r"hassan ii"),
    ("Sheikh Zayed bin Sultan", "politics", r"zayed bin sultan"),
    ("Sheikh Khalifa bin Zayed", "politics", r"khalifa bin zayed"),
    ("Talaat Harb", "culture", r"talaat harb"),
    ("Ahmed Badrakhan", "culture", r"badrakhan"),
    ("Munira al-Mahdiyya", "culture", r"munira al-?mahdiy|mounira al-?mahdiy"),
    ("Fathiyya Ahmad", "culture", r"fath[iy]+a ahm"),
    ("Naguib El-Rihani", "culture", r"rihani"),
    ("Naguib Mahfouz", "culture", r"mahfouz"),
    ("Tawfiq al-Hakim", "culture", r"tawfiq al-?hakim"),
    ("Abdo Saleh (qanun)", "musician", r"abdo saleh|muhammad abdo saleh"),
    ("Ahmad al-Hefnawy (violin)", "musician", r"ahmad al-hefnawy"),
    ("Farouk Salama", "musician", r"farouk salama"),
    ("Fikri Saleh", "culture", r"f[ie]kri saleh"),
    ("Bruno Coquatrix", "culture", r"coquatrix"),
    ("Mohamed Salmawy", "culture", r"salmaw[iy]"),
    ("Salwa Hegazi", "media", r"salwa heg|salwa hij"),
]

SONGS = [
    ("Al-Atlal", r"atl[aā]l|الاطلال|الأطلال"),
    ("Inta Umri", r"\b[ie]nta .?umri|enta omri|انت عمر"),
    ("Alf Leila wa Leila", r"alf lay?la|alf leila|one thousand and one nights"),
    ("Ya Zalimni", r"zal[ie]?mni|zalmani"),
    ("Fat al-Ma'ad", r"f[ai]t? ?(al|el)[- ]?ma.?a+d"),
    ("Hadhihi Laylati", r"hadhihi laylati"),
    ("Amal Hayati", r"amal hayati"),
    ("Aqbal al-Layl", r"aqbal al-?layl"),
    ("Ansak", r"\bansak\b"),
    ("Ba'id 'Anak", r"ba.?[ie]e?d .?ann?ak|بعيد عنك"),
    ("Fakkaruni", r"fakk?aruni|فكرون"),
    ("Hajartak", r"hajartak"),
    ("Raqq il-Habib", r"raqq il-?habib"),
    ("Ana Fi Intizarak", r"intizarak"),
    ("Shams il-Asil", r"shams il-?asil"),
    ("Salu Ku'us al-Tila", r"ku.?us al-?tila"),
    ("Salu Qalbi", r"salu qalbi"),
    ("Ruba'iyat al-Khayyam", r"ruba.?iyat"),
    ("Dalili Ihtar", r"dalili [ae]h?taa?r"),
    ("Misr Tatahaddath 'An Nafsiha", r"tatahaddath"),
    ("Ila 'Arafat Allah", r"arafati? ?(illah|allah)|عرفات الله"),
    ("Qissat al-Sadd", r"qiss?at al-?sadd|قصة السد"),
    ("Ya Gamal Ya Mithal al-Wataniyya", r"mithal al-?watan|يا جمال يا مثال"),
    ("Il-Qalb Ya'shaq Kull Jamil", r"ya.?shaq kull|يعشق كل جميل"),
    ("Al-Hubb Kulluh", r"hubb kulluh"),
    ("Aghadan Alqak", r"aghadan"),
    ("Is'al Ruhak", r"is.?al ruhak"),
    ("Laylat Hubb", r"lay?l[ai]t (il-)?h[ou]bb\b"),
    ("Huwah Sahih", r"huwah? sahih"),
    ("Hallit Layali al-Qamar", r"hall?it layali|halt layali"),
    ("Ghanni Li Shwayya Shwayya", r"ghanni li"),
    ("Hubb Eeh", r"hubb eeh|حب إيه"),
    ("Asbaha Indi al-Aan Bunduqiyya", r"bunduq|بندقية"),
    ("Sawt al-Watan", r"s[au]wt al-?watan|صوت الوطن"),
    ("Sawt al-Salam", r"sawt al-?salam|صوت السلام"),
    ("Ifrah Ya Qalbi", r"ifrah ya qalbi|افرح يا ?قلب"),
    ("Hadith al-Ruh", r"hadith al-?ruh|حديث الروح"),
    ("Lissah Fakir", r"lissah fakir|لسه فاكر"),
    ("Al-Wahda", r"al-wahda"),
    ("Baghdad Ya Qalaat al-Usud", r"qalaat al-?usud"),
    ("Nashid al-Jaish", r"nashid al-?jaish|نشيد الجيش"),
    ("Mahallak Ya Masri", r"mahallak|محلاك"),
    ("Ya Rasoul Allah", r"ya rasoul allah"),
    ("Qissat al-Nil (Poem of the Nile)", r"poem of the nile|قصيدة النيل"),
    ("Film: Wedad (1936)", r"\bwedad\b|\bwydad\b"),
    ("Film: Nashid al-Amal (1937)", r"nashid al-?amal|نشيد الأمل"),
]

# --------------------------------------------------------------- locations
CITIES = [  # (match regex, canonical city)
    (r"cairo|zamalek|maadi|abdeen|helwan|ramses|azbak|downtown|hada.iq|masr al-jadidah|heliopolis|giza|manial", "Cairo"),
    (r"alexandria", "Alexandria"),
    (r"tamay|senbl?[ae]?w|senbel|dakahlia", "Tamay al-Zahira (birth village)"),
    (r"paris", "Paris"), (r"damascus", "Damascus"), (r"beirut", "Beirut"), (r"aley", "Aley"),
    (r"rabat", "Rabat"), (r"baghdad", "Baghdad"), (r"london", "London"), (r"ras el-bar", "Ras El-Bar"),
    (r"jerusalem", "Jerusalem"), (r"jaffa", "Jaffa"), (r"haifa", "Haifa"), (r"aswan", "Aswan"),
    (r"abu dhabi", "Abu Dhabi"), (r"tanta", "Tanta"), (r"suez", "Suez"), (r"moscow", "Moscow"),
    (r"malaw", "Mallawi"), (r"maryland", "Maryland"), (r"mahalla", "El-Mahalla El-Kubra"),
    (r"benghazi", "Benghazi"), (r"kafr el-sheikh", "Kafr El-Sheikh"), (r"khartoum", "Khartoum"),
    (r"tunis", "Tunis"), (r"carthage", "Carthage"), (r"israel/palestine", "Israel/Palestine"), (r"karachi|lahore|pakistan", "Pakistan"),
    (r"kuwait", "Kuwait"), (r"tripoli", "Tripoli"), (r"casablanca", "Casablanca"),
]
COUNTRIES = [
    (r"egypt|cairo|alexandria|delta", "Egypt"), (r"france|paris", "France"), (r"syria", "Syria"),
    (r"lebanon", "Lebanon"), (r"morocco", "Morocco"), (r"iraq", "Iraq"), (r"united kingdom|london", "United Kingdom"),
    (r"palestine|israel", "Palestine"), (r"uae|emirates|abu dhabi", "UAE"), (r"soviet|russia", "Soviet Union"),
    (r"usa|united states|maryland", "USA"), (r"libya", "Libya"), (r"sudan", "Sudan"), (r"tunisia", "Tunisia"),
    (r"pakistan", "Pakistan"), (r"kuwait", "Kuwait"), (r"qatar", "Qatar"), (r"bahrain", "Bahrain"),
    (r"saudi|mecca|makkah|al-ula", "Saudi Arabia"), (r"austria|gastein", "Austria"),
    (r"uzbek|tashkent", "Uzbekistan"),
]


def fold(s):
    """lowercase + strip Latin diacritics (keeps Arabic letters)."""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def clean(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):  # Excel date cells
        return f"{v.day} {v:%B %Y}"
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).replace(" ", " ").strip()
    s = re.sub(r"[ \t]{3,}", "\n", s)  # wide column padding = separate items
    s = re.sub(r"\n{2,}", "\n", s)
    return s


def parse_coords(s):
    s = s.replace("−", "-")
    m = re.search(r"(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*[\"″]?\s*([NS])\s*,?\s*(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*[\"″]?\s*([EW])", s)
    if m:
        lat = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
        lon = int(m[5]) + int(m[6]) / 60 + float(m[7]) / 3600
        return (-lat if m[4] == "S" else lat, -lon if m[8] == "W" else lon)
    m = re.search(r"(-?\d{1,3}\.\d+)\s*°?\s*([NS])?\s*[, ]\s*(-?\d{1,3}\.\d+)\s*°?\s*([EW])?", s)
    if m:
        lat, lon = float(m[1]), float(m[3])
        if m[2] == "S":
            lat = -lat
        if m[4] == "W":
            lon = -lon
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return (lat, lon)
    return None


def first_match(table, text):
    t = fold(text)
    for pat, name in table:
        if re.search(pat, t):
            return name
    return ""


def find_all(table, text):
    t = fold(text)
    out = []
    for entry in table:
        name, pat = entry[0], entry[-1]
        if re.search(pat, t) and name not in out:
            out.append(name)
    return out


def urls(s):
    return [u.rstrip(".,;)") for u in re.findall(r"https?://[^\s]+", s)]


def youtube_id(u):
    m = re.search(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})", u)
    return m[1] if m else None


def main():
    ws = openpyxl.load_workbook(XLSX, read_only=True, data_only=True).worksheets[0]  # cached values, not formulas
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h else "" for h in rows[0]]
    recs = []
    for r in rows[1:]:
        if not any(r):
            continue
        d = {h: clean(v) for h, v in zip(hdr, r)}
        if not d.get("CODE"):
            continue
        # one row has the date and city cells swapped in the spreadsheet
        if re.match(r"\d{1,2} \w+ \d{4}", d["City/ Country"]) and not re.search(r"\d{4}", d["Event Date / Time Range"]):
            d["City/ Country"], d["Event Date / Time Range"] = d["Event Date / Time Range"], d["City/ Country"]
        cityraw = d["City/ Country"]
        coords_raw = d["Co-ordinates"]
        pc = parse_coords(coords_raw)
        note = re.sub(r"^[\s\d.,°'′\"″NSEW-]+", "", coords_raw).strip(" ()") if pc else coords_raw
        people_text = d["Associated People"]
        song_text = d["Associated Works / Songs"]
        desc = d["Description"]
        av = urls(d["Audio/Video Links"])
        recs.append({
            "code": int(float(d["CODE"])),
            "name": d["Site Name"],
            "nameAr": d["Alternative / Native Name"],
            "category": d["Place Category / Classification"],
            "cityRaw": cityraw,
            "city": first_match(CITIES, cityraw) or re.split(r"[,/.]", cityraw)[0].strip() or "Unknown",
            "country": first_match(COUNTRIES, cityraw) or "Unknown",
            "lat": pc[0] if pc else None,
            "lon": pc[1] if pc else None,
            "coordNote": note,
            "approx": False,
            "date": d["Event Date / Time Range"],
            "accuracy": d["Accuracy Level"],
            "eventType": d["Event Type"],
            "people": people_text,
            "works": song_text,
            "locationInfo": d["Location Info"],
            "description": desc,
            "tags": [t.strip() for t in re.split(r"[,،;\n]", d["Tags / Keywords"]) if t.strip()],
            "avLinks": av,
            "youtube": next((y for y in map(youtube_id, av) if y), None),
            "imageLinks": urls(d["Images / Reference"]),
            "personIds": find_all(PEOPLE, people_text + "\n" + song_text + "\n" + desc),
            "songIds": find_all(SONGS, song_text + "\n" + desc + "\n" + d["Tags / Keywords"]),
        })

    # places with no usable coordinates: place them at the average of their city
    by_city = {}
    for r in recs:
        if r["lat"] is not None:
            by_city.setdefault(r["city"], []).append((r["lat"], r["lon"]))
    fallback = {"Egypt": (30.0444, 31.2357)}
    for r in recs:
        if r["lat"] is None:
            pts = by_city.get(r["city"])
            if pts:
                r["lat"] = sum(p[0] for p in pts) / len(pts)
                r["lon"] = sum(p[1] for p in pts) / len(pts)
            elif r["country"] in fallback:
                r["lat"], r["lon"] = fallback[r["country"]]
            r["approx"] = r["lat"] is not None

    people = [{"id": n, "role": role} for n, role, _ in PEOPLE]
    songs = [{"id": n} for n, _ in SONGS]
    used_p = {p for r in recs for p in r["personIds"]}
    used_s = {s for r in recs for s in r["songIds"]}
    data = {
        "places": recs,
        "people": [p for p in people if p["id"] in used_p],
        "songs": [s for s in songs if s["id"] in used_s],
    }
    OUT.write_text("// generated by build_data.py from umm_kulthum_dataset.xlsx — do not edit by hand\n"
                   "window.UK_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")

    print(f"{len(recs)} places, {len(data['people'])} people, {len(data['songs'])} songs -> {OUT}")
    print("approx coords:", [r["code"] for r in recs if r["approx"]])
    print("no coords:", [(r["code"], r["coordNote"][:40]) for r in recs if r["lat"] is None])
    print("no links:", [r["code"] for r in recs if not r["personIds"] and not r["songIds"]])
    print("unknown city:", sorted({(r["city"], r["country"]) for r in recs if r["country"] == "Unknown" or r["city"] == "Unknown"}))


if __name__ == "__main__":
    main()
