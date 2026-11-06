/* Optional AI "seminar": three voices narrate one place, grounded in its dataset row.
   Every provider speaks the OpenAI chat-completions format, so one fetch covers all. */
(function () {
  const PROVIDERS = {
    groq: {
      label: "Groq (free API key)",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "openai/gpt-oss-120b",
      key: true,
      note: "Same model as the original app. Get a free key at console.groq.com/keys.",
    },
    gemini: {
      label: "Google Gemini (free API key)",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: "gemini-2.5-flash",
      key: true,
      note: "Strong Arabic. Get a free key at aistudio.google.com/apikey.",
    },
    openrouter: {
      label: "OpenRouter (free models, API key)",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "openai/gpt-oss-120b:free",
      key: true,
      note: "Use any model ending in “:free”. Key at openrouter.ai/keys.",
    },
    webllm: {
      label: "In your browser (WebLLM, no key, no server)",
      url: null,
      model: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
      key: false,
      note: "Runs an open model on your own GPU (needs Chrome/Edge with WebGPU). The first run downloads about 2 GB, cached afterwards. Smaller and faster: Qwen2.5-1.5B-Instruct-q4f16_1-MLC. Quality is below the hosted models, especially in Arabic.",
    },
    ollama: {
      label: "Ollama (runs on your computer)",
      url: "http://localhost:11434/v1/chat/completions",
      model: "qwen2.5:7b",
      key: false,
      note: "Fully offline. Start it with: OLLAMA_ORIGINS=\"*\" ollama serve, after: ollama pull qwen2.5:7b",
    },
  };
  const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";
  let webllm = null; // { model, engine }
  let onProgress = () => {};

  const LS = "uk-ai-settings-v1";
  const CACHE = "uk-seminar-v1-";

  function store(fn) { try { return fn(); } catch (e) { return null; } }
  function loadSettings() {
    const s = store(() => JSON.parse(localStorage.getItem(LS))) || {};
    const provider = PROVIDERS[s.provider] ? s.provider : "groq";
    return { provider, model: s.model || PROVIDERS[provider].model, keys: s.keys || {} };
  }
  let settings = loadSettings();
  function saveSettings(s) { settings = s; store(() => localStorage.setItem(LS, JSON.stringify(s))); }

  const BILINGUAL = (nameAr) =>
    "You MUST respond BILINGUALLY: first in English (exactly 2 paragraphs), then in Arabic (exactly 2 paragraphs). " +
    "For the Arabic, write as a native Arabic scholar in eloquent Modern Standard Arabic (الفصحى); do NOT translate the English literally — compose the Arabic natively. " +
    `NEVER use Latin letters or Western numerals inside the Arabic paragraphs (e.g. write ${nameAr}, write الثلاثينيات not 1930s). ` +
    "Do NOT mention the CODE number. Use exactly this format:\n[English]\n<2 paragraphs>\n\n[العربية]\n<2 paragraphs>";

  const VOICES = [
    {
      id: "umm", name: "Umm Kulthum", lens: "Experiential", ar: "أم كلثوم",
      system: () =>
        "You are the legendary Egyptian singer Umm Kulthum (Kawkab al-Sharq). Speak in the first person, reflecting on your own life with emotion, nostalgia and humility, " +
        "as if recalling this exact memory to a close friend. Base every detail strictly on the dataset evidence: do not invent facts, but express how these true events felt. " +
        BILINGUAL("أم كلثوم not Umm Kulthum"),
    },
    {
      id: "nora", name: "Pierre Nora", lens: "Memory", ar: "بيير نورا",
      system: () =>
        "You are the French historian Pierre Nora. With the analytical voice of a scholar of memory, analyse Umm Kulthum's recollection and the dataset facts as a 'lieu de mémoire'. " +
        "Explain how collective memory crystallises at this location, grounded in the actual dates, people and evidence in the dataset. " +
        BILINGUAL("بيير نورا not Pierre Nora"),
    },
    {
      id: "lefebvre", name: "Henri Lefebvre", lens: "Space", ar: "هنري لوفيفر",
      system: () =>
        "You are the French Marxist philosopher Henri Lefebvre. With a critical sociological voice about the production of space, analyse this location through your spatial triad " +
        "(perceived, conceived, lived space). Ground the critique strictly in the dataset: how social relations, gender (Umm Kulthum as a powerful woman in public life) and power produced this space. " +
        BILINGUAL("هنري لوفيفر not Henri Lefebvre"),
    },
  ];

  function context(p) {
    return [
      "STRICT RULE: Use ONLY the information below. Do not invent facts, dates, people or songs. Draw on every field.",
      "",
      `Site Name: ${p.name}`,
      `Alternative / Native Name: ${p.nameAr}`,
      `Place Category: ${p.category}`,
      `City / Country: ${p.cityRaw}`,
      `Event Date / Time Range: ${p.date}`,
      `Accuracy Level: ${p.accuracy}`,
      `Event Type: ${p.eventType}`,
      `Associated People: ${p.people}`,
      `Associated Works / Songs: ${p.works}`,
      `Location Info: ${p.locationInfo}`,
      `Description: ${p.description}`,
      `Tags: ${p.tags.join(", ")}`,
    ].join("\n");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const tidy = (t) => t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  async function chatInBrowser(system, user) {
    if (!navigator.gpu) throw new Error("This browser has no WebGPU. Use a recent Chrome or Edge, or pick another provider in Settings.");
    const model = settings.model || PROVIDERS.webllm.model;
    if (!webllm || webllm.model !== model) {
      const lib = await import(WEBLLM_URL);
      if (webllm) await webllm.engine.unload();
      const engine = await lib.CreateMLCEngine(model, {
        initProgressCallback: (p) => onProgress(p.text || ""),
      });
      webllm = { model, engine };
      onProgress("");
    }
    const r = await webllm.engine.chat.completions.create({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.7,
      max_tokens: 1400,
    });
    return tidy(r.choices[0].message.content || "");
  }

  async function chat(system, user, signal) {
    if (settings.provider === "webllm") return chatInBrowser(system, user);
    const prov = PROVIDERS[settings.provider];
    const headers = { "Content-Type": "application/json" };
    if (prov.key) {
      const k = settings.keys[settings.provider];
      if (!k) throw new Error(`Add your free ${prov.label.split(" (")[0]} API key in Settings (⚙︎).`);
      headers.Authorization = "Bearer " + k;
    }
    const body = JSON.stringify({
      model: settings.model || prov.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(prov.url, { method: "POST", headers, body, signal });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error(settings.provider === "ollama"
          ? "Could not reach Ollama on localhost:11434. Is it running with OLLAMA_ORIGINS=\"*\"?"
          : "Network error reaching " + new URL(prov.url).host + ".");
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`${res.status} from ${new URL(prov.url).host}: ${t.slice(0, 200)}`);
      }
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content;
      if (!text) throw new Error("The model returned an empty answer.");
      return tidy(text);
    }
  }

  /** Runs the three voices in order; onVoice(i, text|null, error|null) fires as each finishes. */
  async function seminar(place, onVoice, signal) {
    const key = CACHE + settings.provider + "-" + (settings.model || "") + "-" + place.code;
    const cached = store(() => JSON.parse(localStorage.getItem(key)));
    if (cached && cached.length === 3) {
      cached.forEach((t, i) => onVoice(i, t, null));
      return { cached: true };
    }
    const ctx = context(place);
    const out = [];
    let prompt = ctx + "\n\nTask: speak about this place.";
    for (let i = 0; i < VOICES.length; i++) {
      try {
        const t = await chat(VOICES[i].system(), prompt, signal);
        out.push(t);
        onVoice(i, t, null);
        prompt += `\n\n${VOICES[i].name}'s response:\n${t}`;
      } catch (e) {
        if (e.name === "AbortError") return { aborted: true };
        onVoice(i, null, e);
        return { error: e };
      }
    }
    store(() => localStorage.setItem(key, JSON.stringify(out)));
    return { cached: false };
  }

  function clearCache() {
    store(() => Object.keys(localStorage).filter((k) => k.startsWith(CACHE)).forEach((k) => localStorage.removeItem(k)));
  }

  window.UK_AI = {
    PROVIDERS, VOICES, seminar, clearCache, saveSettings,
    get settings() { return settings; },
    set onProgress(fn) { onProgress = fn || (() => {}); },
  };
})();
