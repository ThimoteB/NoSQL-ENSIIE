import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  create, errorMessage, isUncertainWrite, label, request,
  type Catalogs, type Encounter, type EncounterInput, type Player, type PlayerInput,
} from "./api";
import { AudioControls } from "./AudioControls";
import { Skin } from "./Skin";
import { World } from "./World";

type Screen = "menu" | "players" | "create" | "loading" | "journal";
const PAGE_SIZE = 6;
const initialEncounter = { species: "", nickname: "", biome: "", place: "", type: "observation", description: "" };

function useProtectPendingWrite(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [locked]);
}

function Alert({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null;
  return <div className="notice notice-error" role="alert"><span>{message}</span>
    {retry && <button className="button button-small" onClick={retry}>Réessayer</button>}
  </div>;
}

function RecentEncounters() {
  const [items, setItems] = useState<{ encounter: Encounter; species: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request<Encounter[]>("/encounters/recent?limit=3", { signal: controller.signal }),
      request<Catalogs["species"]>("/species", { signal: controller.signal }),
    ]).then(([recent, species]) => setItems(recent.map((encounter) => ({
      encounter, species: label(species, encounter.species_id),
    })))).catch(() => setItems([]));
    return () => controller.abort();
  }, []);
  if (!items.length) return null;
  return <aside className="recent-encounters" aria-label="Dernières rencontres">
    <p className="eyebrow">DERNIÈRES RENCONTRES · LUES DANS REDIS</p>
    <ul>{items.map(({ encounter, species }) => <li key={encounter.id}>
      <strong>{encounter.animal_nickname || species}</strong> · {species}
    </li>)}</ul>
  </aside>;
}

function SectionTitle({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return <header className="section-title"><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{subtitle}</p></header>;
}

function PlayerPicker({ onBack, onCreate, onChoose }: {
  onBack: () => void; onCreate: () => void; onChoose: (player: Player) => void;
}) {
  const [page, setPage] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [selected, setSelected] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setSelected(null);
    // One extra item tells whether a next page exists.
    request<Player[]>(`/players?limit=${PAGE_SIZE + 1}&offset=${page * PAGE_SIZE}`, { signal: controller.signal })
      .then((batch) => { setPlayers(batch.slice(0, PAGE_SIZE)); setHasNext(batch.length > PAGE_SIZE); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, revision]);
  return <main className="screen selection-screen">
    <SectionTitle kicker="REPRENDRE L’AVENTURE" title="Choisir un explorateur" subtitle="Un visage familier. Un nouveau chapitre." />
    <div className="panel selection-panel">
      <div className="panel-toolbar"><span>Profils des explorateurs</span><span className="muted">Page {page + 1}</span></div>
      <Alert message={error} retry={() => setRevision(revision + 1)} />
      {loading ? <p className="empty-state" role="status">Recherche des explorateurs…</p> :
        !error && players.length === 0 ? <div className="empty-state"><span className="empty-icon">◇</span><h2>Aucun explorateur ici</h2>
          <p>Chaque aventure commence par un premier pas.</p><button className="button button-primary" onClick={onCreate}>Créer un explorateur</button></div> :
          <div className="players-grid">
            {players.map((player) => <button key={player.id} className={`player-card ${selected?.id === player.id ? "is-selected" : ""}`}
              aria-pressed={selected?.id === player.id} onClick={() => setSelected(player)}>
              <span className="selection-marker" aria-hidden="true">{selected?.id === player.id ? "◆" : "◇"}</span>
              <Skin uuid={player.minecraft_uuid} name={player.username} compact />
              <span className="player-name">{player.username}</span>
              <span className="player-description">{player.description || "Prêt à explorer de nouveaux horizons."}</span>
              {player.sync_status === "pending" && <span className="pending">Synchronisation en attente</span>}
            </button>)}
          </div>}
      <div className="pagination">
        <button className="button button-small" disabled={loading || page === 0} onClick={() => setPage(page - 1)}>← Précédent</button>
        <span className="muted">Profils publics · sans connexion</span>
        <button className="button button-small" disabled={loading || !hasNext || Boolean(error)} onClick={() => setPage(page + 1)}>Suivant →</button>
      </div>
    </div>
    <div className="screen-actions">
      <button className="button" onClick={onBack}>Retour</button>
      <button className="button button-primary" disabled={!selected || loading} onClick={() => selected && onChoose(selected)}>Entrer dans le monde →</button>
    </div>
  </main>;
}

function CreatePlayer({ onBack, onCreated }: { onBack: () => void; onCreated: (player: Player) => void }) {
  const [form, setForm] = useState({ username: "", description: "", uuid: "" });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ key: string; body: PlayerInput } | null>(null);
  const previewHost = useRef<HTMLElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const body: PlayerInput = {
      username: form.username.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.uuid.trim() ? { minecraft_uuid: form.uuid.trim() } : {}),
    };
    attempt.current ??= { key: crypto.randomUUID(), body };
    try {
      const player = await create<Player>("/players", attempt.current.body, attempt.current.key);
      onCreated(player);
    } catch (failure) {
      setError(errorMessage(failure));
      const pending = isUncertainWrite(failure);
      setUncertain(pending);
      if (!pending) attempt.current = null;
    } finally { setBusy(false); }
  }
  const blocked = busy || uncertain;
  useProtectPendingWrite(blocked);
  return <main className="screen create-screen">
    <SectionTitle kicker="NOUVELLE PARTIE" title="Ton aventure commence ici" subtitle="Crée ton explorateur et laisse une trace dans le monde." />
    <form className="panel create-panel" onSubmit={submit}>
      <aside className="character-preview" ref={previewHost}>
        <span className="eyebrow">TON PERSONNAGE</span>
        <Skin uuid={preview} name={form.username || "l’explorateur"} interactive />
        <strong>{form.username.trim() || "Nouvel explorateur"}</strong>
      </aside>
      <div className="create-fields">
        <h2>Profil d’explorateur</h2>
        <p className="muted">Pas de mot de passe. Juste toi et l’aventure.</p>
        <fieldset disabled={blocked}>
          <label htmlFor="username">Pseudo <span className="required">*</span></label>
          <input id="username" name="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })}
            minLength={3} maxLength={32} pattern="[A-Za-z0-9_]{3,32}" required placeholder="Ex. RenardDesBois" autoComplete="nickname" />
          <small>3 à 32 lettres, chiffres ou tirets bas.</small>
          <label htmlFor="player-description">Quelques mots sur toi <span className="optional">facultatif</span></label>
          <textarea id="player-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={500} rows={3} placeholder="Collectionneur de rencontres, ami des renards…" />
          <label htmlFor="minecraft-uuid">UUID Minecraft Java <span className="optional">facultatif</span></label>
          <input id="minecraft-uuid" value={form.uuid} onChange={(e) => setForm({ ...form, uuid: e.target.value.trim() })}
            pattern="([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellCheck={false} maxLength={36} />
          <div className="field-inline"><small>Pour porter le skin actuel d’un compte Java. Association non vérifiée.</small>
            <button type="button" className="button button-small" onClick={() => {
              const raw = form.uuid.trim();
              if (raw && !/^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(raw)) {
                setPreviewError("Saisis un UUID valide pour afficher l’aperçu."); return;
              }
              setPreviewError(""); setPreview(raw || null);
              previewHost.current?.scrollIntoView({ block: "center", behavior: "instant" });
            }}>Voir le skin</button>
          </div>
        </fieldset>
        <Alert message={previewError} />
        <Alert message={error} />
        {uncertain && <p className="notice">La saisie est conservée et verrouillée pour reprendre exactement la même création. Ne recharge pas la page.</p>}
        <p className="privacy-note">Ton pseudo et ta description seront visibles par tous. Ce profil n’est pas un compte authentifié.</p>
        <div className="form-actions">
          <button type="button" className="button" disabled={blocked} onClick={onBack}>Retour</button>
          <button className="button button-primary" disabled={busy}>{busy ? "Enregistrement…" : uncertain ? "Réessayer la synchronisation" : "Créer mon explorateur →"}</button>
        </div>
      </div>
    </form>
  </main>;
}

function LoadingWorld({ player, onReady, onBack }: {
  player: Player; onReady: (player: Player, catalogs: Catalogs) => void; onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const ready = useRef(onReady);
  ready.current = onReady;
  const steps = ["Retrouver ton explorateur", "Préparer les espèces et les biomes", "Ouvrir le journal d’exploration"];
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStep(0); setError("");
    async function load() {
      try {
        const start = performance.now();
        const profile = await request<Player>(`/players/${player.id}`, { signal: controller.signal });
        setStep(1);
        const [species, biomes, types] = await Promise.all([
          request<Catalogs["species"]>("/species", { signal: controller.signal }),
          request<Catalogs["biomes"]>("/biomes", { signal: controller.signal }),
          request<Catalogs["types"]>("/encounter-types", { signal: controller.signal }),
        ]);
        if (!species.length || !biomes.length || !types.length) throw new Error("Les catalogues sont vides.");
        if (!active) return;
        setStep(2);
        await request<Encounter[]>(`/encounters?player_id=${player.id}&limit=1`, { signal: controller.signal });
        if (!active) return;
        setStep(3);
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 5000 - (performance.now() - start))));
        if (active) ready.current(profile, { species, biomes, types });
      } catch (failure) {
        if (active) setError(errorMessage(failure));
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [player.id, revision]);
  return <main className="screen loading-screen">
    <p className="eyebrow">BIENVENUE, {player.username.toUpperCase()}</p>
    <h1>Préparation du monde</h1>
    <div className="terrain-preview" aria-hidden="true">
      {Array.from({ length: 81 }, (_, index) => {
        const x = index % 9; const y = Math.floor(index / 9);
        const height = Math.round(12 + 17 * Math.sin(x * .9) * Math.cos(y * .6));
        return <span key={index} style={{ "--height": `${height}px`, "--delay": `${(x + y) * 55}ms`,
          "--tile": (x > 5 && y > 3) ? "#456b9c" : height > 20 ? "#8c897e" : "#756248" } as CSSProperties} />;
      })}
    </div>
    <div className="loading-details" aria-live="polite">
      <p>{error ? "Le voyage est interrompu" : step < 3 ? steps[step] + "…" : "Le monde est prêt."}</p>
      <progress max={3} value={step} aria-label="Ressources chargées" />
      <small>{step} / 3 étapes chargées · animation d’ambiance</small>
    </div>
    <Alert message={error} retry={() => setRevision(revision + 1)} />
    {error && <button className="button" onClick={onBack}>Retour au menu</button>}
    <p className="loading-tip">Prends le temps de regarder autour de toi.<br />Les plus belles rencontres ne se cherchent pas toujours.</p>
  </main>;
}

function EncounterForm({ player, catalogs, onBiome, onSaved, onLock }: {
  player: Player; catalogs: Catalogs; onBiome: (biome: string) => void;
  onSaved: () => void; onLock: (locked: boolean) => void;
}) {
  const [form, setForm] = useState(initialEncounter);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ key: string; body: EncounterInput } | null>(null);
  useEffect(() => { onLock(busy || uncertain); }, [busy, uncertain, onLock]);
  useProtectPendingWrite(busy || uncertain);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!form.description.trim()) { setError("Raconte le contexte de ta rencontre."); return; }
    setBusy(true); setError(""); setSaved(false);
    const body: EncounterInput = {
      player_id: player.id, species_id: form.species,
      ...(form.nickname.trim() ? { animal_nickname: form.nickname.trim() } : {}),
      location: { biome_id: form.biome, ...(form.place.trim() ? { label: form.place.trim() } : {}) },
      encounter_type: form.type, description: form.description.trim(),
    };
    attempt.current ??= { key: crypto.randomUUID(), body };
    try {
      await create<Encounter>("/encounters", attempt.current.body, attempt.current.key);
      setSaved(true); setUncertain(false); setForm(initialEncounter); attempt.current = null;
      onBiome("forest");
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
      const pending = isUncertainWrite(failure);
      setUncertain(pending);
      if (!pending) attempt.current = null;
    } finally { setBusy(false); }
  }
  return <div className="panel encounter-layout">
    <aside className="field-guide">
      <p className="eyebrow">CARNET DE TERRAIN</p>
      <h2>Chaque rencontre<br />a son histoire.</h2>
      <p>Un renard entre les arbres, une tortue sur le sable… Garde une trace de ces petits moments.</p>
      <div className="guide-rule" />
      <span className="eyebrow">EXPLORATEUR</span>
      <strong>{player.username}</strong>
      <p className="muted">{player.description || "L’aventure commence au prochain détour."}</p>
      <div className="biome-marker"><span className="status-dot" />{form.biome ? label(catalogs.biomes, form.biome) : "Choisis ton biome"}</div>
    </aside>
    <form className="encounter-form" onSubmit={submit}>
      <div className="panel-heading"><h2>Une nouvelle rencontre</h2><span className="muted">Les champs * sont requis</span></div>
      {saved && <div className="notice notice-success" role="status"><strong>Rencontre ajoutée au journal !</strong><span>Enregistrée dans MongoDB et Redis.</span></div>}
      <Alert message={error} />
      {uncertain && <p className="notice">Saisie conservée : réessaie avec la même clé pour éviter les doublons. Ne recharge pas la page.</p>}
      <fieldset disabled={busy || uncertain}>
        <div className="form-grid">
          <div><label htmlFor="species">Animal rencontré *</label>
            <select id="species" required value={form.species} onChange={(e) => { setForm({ ...form, species: e.target.value }); setSaved(false); }}>
              <option value="">Choisir une espèce…</option>{catalogs.species.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></div>
          <div><label htmlFor="animal-nickname">Son petit nom <span className="optional">facultatif</span></label>
            <input id="animal-nickname" value={form.nickname} maxLength={100} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="Ex. Flamme" /></div>
          <div><label htmlFor="biome">Biome *</label>
            <select id="biome" required value={form.biome} onChange={(e) => { setForm({ ...form, biome: e.target.value }); onBiome(e.target.value || "forest"); }}>
              <option value="">Choisir un biome…</option>{catalogs.biomes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></div>
          <div><label htmlFor="place">Nom du lieu <span className="optional">facultatif</span></label>
            <input id="place" value={form.place} maxLength={100} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="Près du vieux campement…" /></div>
        </div>
        <label htmlFor="encounter-type">Type de rencontre *</label>
        <select id="encounter-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {catalogs.types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <label htmlFor="context">Raconte ce moment *</label>
        <textarea id="context" required maxLength={4000} rows={4} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Comment vos chemins se sont-ils croisés ?" />
        <div className="field-inline"><small>Les petits détails font les belles histoires.</small><small>{form.description.length} / 4000</small></div>
      </fieldset>
      <div className="form-actions"><span className="storage-note"><span className="status-dot" />Double sauvegarde</span>
        <button className="button button-primary" disabled={busy}>{busy ? "Sauvegarde en cours…" : uncertain ? "Réessayer la synchronisation" : "Inscrire dans le journal →"}</button></div>
    </form>
  </div>;
}

function AnimalPortrait({ species, name }: { species: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="animal-image-error" role="status">Image de {name} indisponible</span>
    : <img className="animal-image" src={`/animals/${encodeURIComponent(species)}.webp`}
        alt={name} width={88} height={88} loading="lazy" onError={() => {
          console.error(`Impossible de charger le portrait de l’animal ${species}.`);
          setFailed(true);
        }} />;
}

function EncountersList({ catalogs, revision, currentPlayer }: { catalogs: Catalogs; revision: number; currentPlayer: Player }) {
  const [filters, setFilters] = useState({ player: "", species: "", biome: "" });
  const [players, setPlayers] = useState<Player[]>([currentPlayer]);
  const [playerPage, setPlayerPage] = useState(0);
  const [morePlayers, setMorePlayers] = useState(true);
  const [playersBusy, setPlayersBusy] = useState(false);
  const [playersError, setPlayersError] = useState("");
  const [items, setItems] = useState<Encounter[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [authors, setAuthors] = useState<Record<string, Player>>({ [currentPlayer.id]: currentPlayer });
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const authorCache = useRef(authors);
  const playerController = useRef<AbortController | null>(null);
  useEffect(() => () => playerController.current?.abort(), []);
  useEffect(() => { void loadPlayers(); }, []);
  async function loadPlayers() {
    if (playersBusy) return;
    const controller = new AbortController();
    playerController.current = controller;
    setPlayersBusy(true); setPlayersError("");
    try {
      const batch = await request<Player[]>(`/players?limit=50&offset=${playerPage * 50}`, { signal: controller.signal });
      setPlayers((previous) => Array.from(new Map([...previous, ...batch].map((entry) => [entry.id, entry])).values()));
      setPlayerPage(playerPage + 1); setMorePlayers(batch.length === 50);
    } catch (failure) { if (!controller.signal.aborted) setPlayersError(errorMessage(failure)); }
    finally { if (!controller.signal.aborted) setPlayersBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    const params = new URLSearchParams({ limit: String(PAGE_SIZE + 1), offset: String(page * PAGE_SIZE) });
    if (filters.player) params.set("player_id", filters.player);
    if (filters.species) params.set("species_id", filters.species);
    if (filters.biome) params.set("biome_id", filters.biome);
    async function load() {
      try {
        const result = await request<Encounter[]>(`/encounters?${params}`, { signal: controller.signal });
        const batch = result.slice(0, PAGE_SIZE);
        const unknown = [...new Set(batch.map((item) => item.player_id))].filter((id) => !authorCache.current[id]);
        const profiles = await Promise.all(unknown.map((id) => request<Player>(`/players/${id}`, { signal: controller.signal })));
        if (controller.signal.aborted) return;
        profiles.forEach((profile) => { authorCache.current[profile.id] = profile; });
        setAuthors({ ...authorCache.current }); setItems(batch); setHasNext(result.length > PAGE_SIZE);
      } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, [page, filters, revision, reload]);
  function filter(name: keyof typeof filters, value: string) {
    setFilters({ ...filters, [name]: value }); setPage(0);
  }
  return <section className="panel journal-list" aria-label="Rencontres des explorateurs">
    <div className="panel-heading"><div><p className="eyebrow">LE MONDE A DES HISTOIRES</p><h2>Le journal des explorateurs</h2></div>
      <button className="button button-small" disabled={busy} onClick={() => setReload(reload + 1)}>Actualiser</button></div>
    <div className="list-filters">
      <label>Explorateur<select value={filters.player} onChange={(e) => filter("player", e.target.value)}>
        <option value="">Tous les explorateurs</option>{players.map((player) => <option value={player.id} key={player.id}>{player.username}</option>)}
      </select></label>
      <label>Espèce<select value={filters.species} onChange={(e) => filter("species", e.target.value)}>
        <option value="">Tous les animaux</option>{catalogs.species.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>Biome<select value={filters.biome} onChange={(e) => filter("biome", e.target.value)}>
        <option value="">Tous les biomes</option>{catalogs.biomes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    {morePlayers && <button className="text-button" disabled={playersBusy} onClick={() => void loadPlayers()}>
      {playersBusy ? "Chargement des profils…" : "Charger davantage d’explorateurs dans le filtre"}
    </button>}
    <Alert message={playersError} />
    <Alert message={error} retry={() => setReload(reload + 1)} />
    {busy ? <p className="empty-state" role="status">Lecture du journal…</p> : !error && <>
      {items.length === 0 ? <div className="empty-state"><span className="empty-icon">▤</span><h2>Une page encore blanche</h2>
        <p>Aucune rencontre ne correspond à ces filtres. La prochaine sera peut-être la tienne.</p></div> :
        <div className="encounter-grid">{items.map((item) => <article className="encounter-card" key={item.id}>
          <div className="encounter-card-top"><AnimalPortrait species={item.species_id} name={label(catalogs.species, item.species_id)} />
            <div><h3>{item.animal_nickname || label(catalogs.species, item.species_id)}</h3>
              <span className="muted">{label(catalogs.species, item.species_id)} · {label(catalogs.types, item.encounter_type)}</span></div>
            <span className="biome-badge">{label(catalogs.biomes, item.location.biome_id)}</span></div>
          <p className="encounter-story">{item.description}</p>
          {item.location.label && <p className="place-label">⌖ {item.location.label}</p>}
          <footer><span>Par <strong>{authors[item.player_id]?.username ?? item.player_id}</strong></span>
            <time dateTime={item.created_at} title="Date de publication">{new Date(item.created_at).toLocaleDateString("fr-FR")}</time></footer>
          {item.sync_status === "pending" && <p className="pending">Conservée dans MongoDB · synchronisation Redis en attente</p>}
        </article>)}</div>}
      <div className="pagination"><button className="button button-small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Précédent</button>
        <span>Page {page + 1}</span><button className="button button-small" disabled={!hasNext} onClick={() => setPage(page + 1)}>Suivant →</button></div>
    </>}
  </section>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [player, setPlayer] = useState<Player | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [biome, setBiome] = useState("forest");
  const [tab, setTab] = useState<"form" | "list">("form");
  const [revision, setRevision] = useState(0);
  const [locked, setLocked] = useState(false);
  const focus = useRef<HTMLDivElement>(null);
  useEffect(() => { focus.current?.focus(); }, [screen]);
  const enter = (chosen: Player) => { setPlayer(chosen); setScreen("loading"); };
  const menu = () => { setScreen("menu"); setPlayer(null); setCatalogs(null); setLocked(false); setTab("form"); };
  return <div className={`app screen-${screen}`}>
    <World biome={biome} menu={screen === "menu"} />
    <div className="topbar"><span className="brand-mark">CookieCraft : Explorers <span className="brand-sub">JOURNAL · JAVA EDITION</span></span><AudioControls /></div>
    <div ref={focus} tabIndex={-1} className="page-content">
      {screen === "menu" && <main className="menu-screen">
        <p className="eyebrow menu-eyebrow"><span /> LE MONDE EST PLEIN DE RENCONTRES <span /></p>
        <div className="title-lockup"><h1 aria-label="CookieCraft : Explorers">
          <span className="title-word">COOKIECRAFT<span className="splash" aria-hidden="true">L’aventure est dehors !</span></span>
          <span className="title-edition">: EXPLORERS</span></h1></div>
        <p className="menu-subtitle">Ton monde. Tes rencontres. Ton histoire.</p>
        <div className="menu-buttons">
          <button className="button button-primary button-menu" onClick={() => setScreen("players")}><span aria-hidden="true">▶</span> Continuer</button>
          <button className="button button-menu" onClick={() => setScreen("create")}><span aria-hidden="true">＋</span> Nouvelle partie</button>
        </div>
        <p className="menu-caption">Choisis un explorateur ou commence une nouvelle aventure.</p>
        <div className="menu-detail"><span>Un carnet pour les curieux.<br /><strong>Un monde à observer.</strong></span></div>
        <RecentEncounters />
      </main>}
      {screen === "players" && <PlayerPicker onBack={menu} onCreate={() => setScreen("create")} onChoose={enter} />}
      {screen === "create" && <CreatePlayer onBack={menu} onCreated={enter} />}
      {screen === "loading" && player && <LoadingWorld player={player} onBack={menu} onReady={(profile, data) => {
        setPlayer(profile); setCatalogs(data); setScreen("journal"); setTab("form");
      }} />}
      {screen === "journal" && player && catalogs && <main className="screen journal-screen">
        <header className="journal-header"><div><p className="eyebrow">L’AVENTURE CONTINUE</p><h1>Le journal d’exploration</h1></div>
          <div className="current-player"><Skin uuid={player.minecraft_uuid} name={player.username} compact />
            <div className="current-player-details"><strong>{player.username}</strong><span>Explorateur actif</span></div>
            <button className="button button-small button-dark" disabled={locked} onClick={menu}>Changer</button></div></header>
        <div className="tabs" role="tablist" aria-label="Journal">
          <button className={`tab ${tab === "form" ? "active" : ""}`} role="tab" id="form-tab" aria-selected={tab === "form"} aria-controls="form-panel"
            tabIndex={tab === "form" ? 0 : -1} onClick={() => setTab("form")} onKeyDown={(e) => { if (e.key === "ArrowRight") { setTab("list"); document.getElementById("list-tab")?.focus(); } }}>✎ Nouvelle rencontre</button>
          <button className={`tab ${tab === "list" ? "active" : ""}`} role="tab" id="list-tab" aria-selected={tab === "list"} aria-controls="list-panel"
            tabIndex={tab === "list" ? 0 : -1} onClick={() => setTab("list")} onKeyDown={(e) => { if (e.key === "ArrowLeft") { setTab("form"); document.getElementById("form-tab")?.focus(); } }}>▤ Toutes les rencontres</button>
        </div>
        <div id="form-panel" role="tabpanel" aria-labelledby="form-tab" hidden={tab !== "form"}>
          <EncounterForm player={player} catalogs={catalogs} onBiome={setBiome} onSaved={() => setRevision(revision + 1)} onLock={setLocked} />
        </div>
        <div id="list-panel" role="tabpanel" aria-labelledby="list-tab" hidden={tab !== "list"}>
          {tab === "list" && <EncountersList catalogs={catalogs} revision={revision} currentPlayer={player} />}
        </div>
      </main>}
    </div>
    <footer className="site-footer"><span>CookieCraft</span>
      <span className="footer-right"><a href="/biomes/credits.json" target="_blank" rel="noreferrer">Crédits des captures</a> · <a href="/animals/credits.json" target="_blank" rel="noreferrer">Crédits des animaux</a></span></footer>
  </div>;
}
