import { useEffect, useRef, useState } from "react";

interface AudioManifest { music: string | null; click: string | null }
interface Preferences { enabled: boolean; music: number; effects: number }
const defaults: Preferences = { enabled: true, music: .2, effects: .25 };

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem("journal-audio") ?? "null");
    if (!value) return defaults;
    if (typeof value.enabled !== "boolean" || typeof value.music !== "number" || typeof value.effects !== "number"
      || !Number.isFinite(value.music) || !Number.isFinite(value.effects)
      || value.music < 0 || value.music > 1 || value.effects < 0 || value.effects > 1) {
      throw new Error("Préférences audio invalides");
    }
    return value;
  } catch (error) {
    console.warn("Unable to restore audio preferences; using defaults", error);
    return defaults;
  }
}

function audioPath(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\/audio\/[a-zA-Z0-9_-]+\.(mp3|ogg|wav)$/.test(value)) {
    throw new Error("Le manifeste doit utiliser des fichiers locaux /audio/nom.mp3, .ogg ou .wav.");
  }
  return value;
}

export function AudioControls() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<AudioManifest | null>(null);
  const [error, setError] = useState("");
  const prefs = useRef(preferences);
  const music = useRef<HTMLAudioElement | null>(null);
  const click = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null);
  const interacted = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/audio/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Manifeste audio : HTTP ${response.status}`);
        const data = await response.json();
        setManifest({ music: audioPath(data.music), click: audioPath(data.click) });
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          console.error("Audio configuration failed", failure);
          setError("Configuration audio indisponible.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    prefs.current = preferences;
    try { localStorage.setItem("journal-audio", JSON.stringify(preferences)); }
    catch (failure) {
      console.warn("Unable to save audio preferences", failure);
      setError("Les préférences audio ne peuvent pas être mémorisées.");
    }
    if (music.current) {
      music.current.volume = preferences.music;
      if (!preferences.enabled) music.current.pause();
    }
  }, [preferences]);

  useEffect(() => {
    const report = () => setError("Un fichier audio ne peut pas être lu. Vérifie le manifeste et les fichiers.");
    const track = manifest?.music ? new Audio(manifest.music) : null;
    const effect = manifest?.click ? new Audio(manifest.click) : null;
    music.current = track;
    click.current = effect;
    if (track) {
      track.loop = true;
      track.preload = "none";
      track.volume = prefs.current.music;
      track.addEventListener("error", report);
    }
    if (effect) { effect.preload = "none"; effect.addEventListener("error", report); }
    const play = (audio: HTMLAudioElement) => {
      void audio.play().catch((failure: unknown) => {
        console.warn("Audio playback failed", failure);
        setError("Lecture audio bloquée. Active le son avec le bouton Son.");
      });
    };
    const onInteraction = (event: Event) => {
      if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key)) return;
      if (event instanceof KeyboardEvent && event.repeat) return;
      interacted.current = true;
      if (!prefs.current.enabled) return;
      if (track?.paused) { track.volume = prefs.current.music; play(track); }
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("button:not(:disabled)") || prefs.current.effects === 0) return;
      if (effect) {
        effect.volume = prefs.current.effects;
        effect.currentTime = 0;
        play(effect);
      } else {
        try {
          context.current ??= new AudioContext();
          const audio = context.current;
          void audio.resume().catch(report);
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = "triangle";
          oscillator.frequency.setValueAtTime(540, audio.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(280, audio.currentTime + .065);
          gain.gain.setValueAtTime(prefs.current.effects * .25, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .075);
          oscillator.connect(gain).connect(audio.destination);
          oscillator.start();
          oscillator.stop(audio.currentTime + .08);
        } catch (failure) {
          console.warn("Sound effect unavailable", failure);
          setError("Les effets sonores ne sont pas disponibles sur ce navigateur.");
        }
      }
    };
    const onVisibility = () => {
      if (document.hidden) track?.pause();
      else if (track && interacted.current && prefs.current.enabled) play(track);
    };
    document.addEventListener("pointerdown", onInteraction);
    document.addEventListener("keydown", onInteraction);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("pointerdown", onInteraction);
      document.removeEventListener("keydown", onInteraction);
      document.removeEventListener("visibilitychange", onVisibility);
      track?.pause();
      effect?.pause();
      track?.removeEventListener("error", report);
      effect?.removeEventListener("error", report);
      void context.current?.close();
      context.current = null;
    };
  }, [manifest]);

  return (
    <div className="audio-controls">
      <button className="button button-small button-dark" aria-expanded={open} aria-controls="audio-settings" onClick={() => setOpen(!open)}>
        {preferences.enabled ? "♫" : "♪"} Son {preferences.enabled ? "activé" : "coupé"}
      </button>
      {open && <section id="audio-settings" className="audio-panel panel" aria-label="Réglages audio">
        <h2>Ambiance sonore</h2>
        <button className="button button-small" onClick={() => {
          const enabled = !preferences.enabled;
          setPreferences({ ...preferences, enabled });
          if (enabled && music.current) {
            void music.current.play().catch(() => setError("Lecture bloquée par le navigateur."));
          }
        }}>{preferences.enabled ? "Couper le son" : "Activer le son"}</button>
        <label>Musique <span>{Math.round(preferences.music * 100)} %</span>
          <input type="range" min="0" max="1" step=".05" value={preferences.music}
            onChange={(event) => setPreferences({ ...preferences, music: Number(event.target.value) })} />
        </label>
        <label>Effets <span>{Math.round(preferences.effects * 100)} %</span>
          <input type="range" min="0" max="1" step=".05" value={preferences.effects}
            onChange={(event) => setPreferences({ ...preferences, effects: Number(event.target.value) })} />
        </label>
        {!manifest?.music && <p className="muted">Musique non configurée. Les MP3 autorisés pourront être ajoutés plus tard.</p>}
        {!manifest?.click && <p className="muted">Clic synthétique original activé.</p>}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
      </section>}
    </div>
  );
}
