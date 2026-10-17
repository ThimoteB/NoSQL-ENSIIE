export interface Player {
  id: string;
  username: string;
  username_normalized: string;
  description: string | null;
  minecraft_uuid: string | null;
  created_at: string;
  sync_status: "pending" | "synced";
}

export interface PlayerInput {
  username: string;
  description?: string;
  minecraft_uuid?: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface EncounterInput {
  player_id: string;
  species_id: string;
  animal_nickname?: string;
  location: { biome_id: string; label?: string };
  encounter_type: string;
  description: string;
}

export interface Encounter extends EncounterInput {
  id: string;
  created_at: string;
  sync_status: "pending" | "synced";
}

export interface SkinInfo {
  minecraft_uuid: string;
  model: "classic" | "slim";
  texture_url: string;
}

export interface Catalogs {
  species: CatalogEntry[];
  biomes: CatalogEntry[];
  types: CatalogEntry[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public resourceId?: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(`/api${path}`, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: { ...options.headers, Accept: "application/json" },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const detail = isRecord(data) ? data.detail : undefined;
    let message = "Le serveur ne peut pas traiter cette demande.";
    let code: string | undefined;
    let resourceId: string | undefined;
    if (isRecord(detail)) {
      if (typeof detail.message === "string") message = detail.message;
      if (typeof detail.code === "string") code = detail.code;
      if (typeof detail.resource_id === "string") resourceId = detail.resource_id;
    } else if (Array.isArray(detail)) {
      message = detail.map((error: unknown) => {
        if (!isRecord(error)) return "Champ invalide";
        const field = Array.isArray(error.loc) ? error.loc.slice(1).join(" · ") : "Champ";
        return `${field} : ${String(error.msg ?? "valeur invalide")}`;
      }).join("\n");
    }
    if (code === "username_exists") message = "Ce pseudo existe déjà. Choisis-en un autre ou utilise Continuer.";
    if (code === "redis_sync_pending") {
      message = "Enregistré dans MongoDB, mais Redis n’a pas encore confirmé. Réessaie sans modifier la saisie pour terminer la synchronisation.";
    }
    throw new ApiError(message, response.status, code, resourceId);
  }
  return data as T;
}

export function create<T>(path: string, body: unknown, key: string): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "Chargement annulé.";
  console.error("Journal request failed", error);
  return "Connexion interrompue. Vérifie que le serveur est disponible puis réessaie.";
}

export function isUncertainWrite(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

export function label(entries: CatalogEntry[], id: string): string {
  return entries.find((entry) => entry.id === id)?.name ?? id;
}
