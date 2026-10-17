import { useEffect, useRef, useState } from "react";
import type { SkinViewer } from "skinview3d";
import { loadSkinToCanvas } from "skinview-utils";
import { errorMessage, request, type SkinInfo } from "./api";
import { CssSkin, type SkinTexture } from "./CssSkin";

function explorerTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Le navigateur ne permet pas de créer la texture du personnage.");
  context.fillStyle = "#c59872";
  context.fillRect(0, 0, 32, 16);
  context.fillStyle = "#423c30";
  context.fillRect(0, 0, 32, 8);
  context.fillRect(8, 8, 8, 2);
  context.fillStyle = "#253c38";
  context.fillRect(9, 11, 2, 1);
  context.fillRect(13, 11, 2, 1);
  context.fillStyle = "#805641";
  context.fillRect(11, 14, 2, 1);
  context.fillStyle = "#3b655b";
  context.fillRect(16, 16, 24, 16);
  context.fillRect(40, 16, 16, 16);
  context.fillRect(32, 48, 16, 16);
  context.fillStyle = "#c59872";
  context.fillRect(40, 28, 16, 4);
  context.fillRect(32, 60, 16, 4);
  context.fillStyle = "#554b3c";
  context.fillRect(0, 16, 16, 16);
  context.fillRect(16, 48, 16, 16);
  context.fillStyle = "#c4ae72";
  context.fillRect(20, 21, 8, 2);
  context.fillRect(23, 20, 2, 8);
  context.fillStyle = "#30372f";
  context.fillRect(0, 29, 16, 3);
  context.fillRect(16, 61, 16, 3);
  return canvas;
}

export function Skin({ uuid, name, interactive = false, compact = false }: {
  uuid?: string | null; name: string; interactive?: boolean; compact?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [texture, setTexture] = useState<SkinTexture | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "80px" });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !viewport.current) return;
    let active = true;
    let viewer: SkinViewer | undefined;
    const canvas = document.createElement("canvas");
    viewport.current.replaceChildren(canvas);
    const controller = new AbortController();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let onMotion: (() => void) | undefined;
    let onVisibility: (() => void) | undefined;
    setMessage("");
    setUnavailable(false);
    setLoading(Boolean(uuid));
    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (active) {
        console.warn("Contexte WebGL perdu : utilisation du rendu 3D CSS.");
        setUnavailable(true);
      }
    };
    const onContextRestored = () => { if (active && viewer) setUnavailable(false); };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    async function prepare() {
      const local = explorerTexture();
      setTexture({ url: local.toDataURL(), model: "classic" });
      try {
        const { SkinViewer: Viewer, IdleAnimation } = await import("skinview3d");
        if (!active) return;
        viewer = new Viewer({
          canvas, width: compact ? 112 : 210, height: compact ? 140 : 270,
          pixelRatio: Math.min(window.devicePixelRatio, 2),
          zoom: .8, enableControls: interactive,
        });
        viewer.loadSkin(local, { model: "default" });
        viewer.playerObject.rotation.y = -.3;
        viewer.controls.enableZoom = false;
        viewer.controls.enablePan = false;
        viewer.animation = new IdleAnimation();
        onMotion = () => {
          if (!viewer) return;
          viewer.autoRotate = !motion.matches;
          viewer.autoRotateSpeed = .22;
          if (viewer.animation) viewer.animation.paused = motion.matches;
        };
        onVisibility = () => { if (viewer) viewer.renderPaused = document.hidden; };
        onMotion();
        onVisibility();
        motion.addEventListener("change", onMotion);
        document.addEventListener("visibilitychange", onVisibility);
      } catch (error) {
        if (active) {
          console.warn("Moteur WebGL indisponible : utilisation du rendu 3D CSS.", error);
          setUnavailable(true);
        }
      }
      if (uuid && active) {
        try {
          const info = await request<SkinInfo>(`/skins/${encodeURIComponent(uuid)}`, { signal: controller.signal });
          if (!active) return;
          const image = new Image();
          image.src = info.texture_url;
          await image.decode();
          if (!active) return;
          const normalized = document.createElement("canvas");
          loadSkinToCanvas(normalized, image);
          setTexture({ url: normalized.toDataURL(), model: info.model });
          viewer?.loadSkin(normalized, { model: info.model === "slim" ? "slim" : "default" });
        } catch (error) {
          if (active) setMessage(`${errorMessage(error)} Apparence de remplacement.`);
        }
      }
      if (active) setLoading(false);
    }
    void prepare();
    return () => {
      active = false;
      controller.abort();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      viewer?.dispose();
      viewer?.renderer.forceContextLoss();
      canvas.remove();
      if (onMotion) motion.removeEventListener("change", onMotion);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [uuid, visible, interactive, compact]);

  return (
    <div className={`skin ${compact ? "skin-compact" : ""}`} ref={host}>
      <div ref={viewport} role="img" aria-label={`Personnage de ${name}`} className={`skin-canvas ${unavailable ? "hidden" : ""}`} />
      {unavailable && texture && <CssSkin texture={texture} name={name} compact={compact} />}
      {unavailable && <span className="skin-status" title="Dans Opera : Réglages → Système → Utiliser l’accélération graphique, puis redémarrer le navigateur.">Mode 3D compatible · WebGL indisponible</span>}
      {loading && <span className="skin-status">Chargement du skin…</span>}
      {message && <span className="skin-warning" role="status" title={message}>⚠ {message}</span>}
      {!uuid && !message && <span className="skin-status">Explorateur local</span>}
      {interactive && !unavailable && <span className="skin-status">Fais glisser le personnage pour le tourner.</span>}
    </div>
  );
}
