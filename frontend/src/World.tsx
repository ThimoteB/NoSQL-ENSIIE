import { useState } from "react";

const biomes = new Set(["plains", "forest", "taiga", "jungle", "desert", "savanna", "swamp", "beach", "ocean", "lush_caves"]);

export function World({ biome = "forest", menu = false }: { biome?: string; menu?: boolean }) {
  const selected = biomes.has(biome) ? biome : "forest";
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={`world ${menu ? "world-menu" : ""}`}>
      <img key={selected} className="world-image" src={`/biomes/${selected}.webp`} alt="" aria-hidden="true"
        onError={() => {
          console.error(`Impossible de charger la capture du biome ${selected}.`);
          setFailed(selected);
        }} />
      <div className="world-vignette" aria-hidden="true" />
      {failed === selected && <p className="world-error" role="status">Arrière-plan indisponible. Le journal reste accessible.</p>}
    </div>
  );
}
