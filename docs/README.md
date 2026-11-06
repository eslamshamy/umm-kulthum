# Umm Kulthum Atlas

A static, no-backend 3D version of the Tri-Agent Spatial Seminar, built with three.js.

- **Entrance**: about 12,000 silver particles form Umm Kulthum on stage (`assets/portrait.jpg`).
  The 151 places and their people and songs are hidden among them. Moving the mouse tilts the
  relief. Click anywhere (or press Enter) and the figure bursts from her face outwards: the data
  nodes spread into the 3D network and the rest drift off into a starfield. If the photo can't
  load, the particles spell أم كلثوم instead. To swap the photo, replace `assets/portrait.jpg` and
  adjust `PORTRAIT_CROP` / `FACE_UV` at the top of `app.js`. The background should be dark.
- **Network** (3D): places are pulled together by what they share. People (diamonds),
  songs and films (triangles) and, optionally, cities (squares) shared by 2+ places are hub nodes.
  Drag to orbit, scroll to zoom.
- **Music**: a tiny player starts with يا ليلة العيد and keeps playing inside the atlas. **⤨**
  shuffles to another song mentioned in the dataset (20 songs, `music.js`); when a song ends, another
  plays. It tries to start with sound immediately. Browsers that block that (most do on a first visit)
  start it on the visitor's first click, which is the click that enters. All recordings stream from
  the Internet Archive as plain audio (no video). `build_music.py` regenerates `music.js`; edit its
  `ITEMS` list to change recordings.
- **Back to the entrance**: click the title "Umm Kulthum Atlas" in the header.
- **Globe**: the same dots fly onto a 3D globe covered with a real map (Esri gray canvas tiles: free,
  no key). Dots sit still at their real coordinates (no stacking) at a small fixed on-screen size.
  Where they would crowd together, only the best-connected place shows; the rest fade in as you
  zoom to **Egypt**, **Cairo** and street level (30 → ~50 → ~100 → all). The map sharpens as you
  zoom, down to the streets of Cairo. **World / Egypt / Cairo** appear only in Globe view.
  Clicking a spot where dots are hidden zooms in until they all show. If several places share exactly
  the same coordinates, the click lists them instead. Selecting a place draws arcs to its connected places.
- **About**: credits. Developed by Eslam Elshamy and Mohammed W. Fareed, Lab of Creative/Critical AI
  (LOCAI), [locai.carrd.co](https://locai.carrd.co).
- **Light / dark mode**: the ☾/☀ button in the header. It follows the system setting until you
  choose, and the choice is remembered. The map tiles switch between dark-gray and light-gray. The
  entrance is always a dark stage.

Click any node to see everything in its row: story, place info, people, works, tags,
an embedded YouTube video, audio/video and reference links, an OpenStreetMap street map,
and a ranked list of connected places. Click a person or song to see all its places. URLs like
`#code=90` link straight to a place.

## Run it

It is plain HTML/JS, so any static server works:

```bash
python3 -m http.server 8791 --directory web
```

Then open http://localhost:8791. It can also be hosted for free on GitHub Pages, Netlify or
Hugging Face Spaces (static).

## AI seminar (optional, all free)

The atlas itself needs no API. The **Generate seminar** button (Umm Kulthum, Pierre Nora and
Henri Lefebvre, in English and Arabic, grounded only in the record) can use any of these.
Choose one in ⚙︎ Settings:

| Provider | Cost | Notes |
|---|---|---|
| Google Gemini | free key | good Arabic |
| OpenRouter | free key | any `:free` model |
| **In your browser (WebLLM)** | no key, no server | **default.** Runs on the visitor's graphics card (WebGPU: Chrome, Edge, recent Safari). First use downloads about 1.7 GB with a progress bar; later visits load from cache in about 20 s. Text appears as it's written. |
| Groq | free key | same `openai/gpt-oss-120b` model as the original app; better writing, especially in Arabic |
| Ollama | no key | runs locally: `OLLAMA_ORIGINS="*" ollama serve` |

Keys stay in the visitor's browser (localStorage) and are never in the code. Generated
seminars are cached per place.

## Updating the data

Edit the spreadsheet, then regenerate `data.js` (needs `openpyxl`):

```bash
python3 web/build_data.py
```

The script parses messy coordinates, normalizes cities and countries, and extracts people
and songs using the alias tables at the top of the file. Add aliases there to link more
records. Places without coordinates are placed at their city's average or, if the city is
unknown, in a small ring under the globe's south pole.
