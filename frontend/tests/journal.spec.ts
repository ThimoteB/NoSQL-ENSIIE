import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function createExplorer(page: Page, username: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle partie", exact: true }).click();
  await page.getByRole("textbox", { name: "Pseudo *", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Quelques mots sur toi facultatif" }).fill("Explorateur créé par le parcours de test.");
  const response = page.waitForResponse((result) => result.url().endsWith("/api/players") && result.request().method() === "POST");
  await page.getByRole("button", { name: "Créer mon explorateur →" }).click();
  const player = await (await response).json();
  await expect(page.getByRole("heading", { name: "Le journal d’exploration", exact: true })).toBeVisible();
  return player;
}

async function fillEncounter(page: Page, description: string) {
  await page.getByRole("tab", { name: "✎ Nouvelle rencontre", exact: true }).click();
  await page.getByRole("combobox", { name: "Animal rencontré *", exact: true }).selectOption("fox");
  await page.getByRole("combobox", { name: "Biome *", exact: true }).selectOption("taiga");
  await page.getByRole("textbox", { name: "Son petit nom facultatif" }).fill("Flamme E2E");
  await page.getByRole("textbox", { name: "Raconte ce moment *", exact: true }).fill(description);
}

test("menu, creation, preserved draft, persistence, filters and profile selection", async ({ page }) => {
  const username = `ZZZ_UI_${randomUUID().slice(0, 8)}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CookieCraft : Explorers", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("CookieCraft : Explorers");
  const word = await page.locator(".title-word").boundingBox();
  const splash = await page.locator(".splash").boundingBox();
  expect(word).not.toBeNull();
  expect(splash).not.toBeNull();
  expect(splash!.y).toBeLessThan(word!.y + word!.height);
  expect(splash!.x + splash!.width).toBeGreaterThan(word!.x + word!.width - 30);
  const next = page.getByRole("button", { name: "Continuer", exact: true });
  const normal = await next.evaluate((element) => getComputedStyle(element).backgroundColor);
  await next.hover();
  expect(await next.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(normal);
  const player = await createExplorer(page, username);
  await expect(page.locator(".current-player .skin")).toBeVisible();
  await expect(page.locator(".skin-pedestal")).toHaveCount(0);
  const tabs = await page.getByRole("tablist").boundingBox();
  const panel = await page.locator(".encounter-layout").boundingBox();
  expect(tabs).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBe(tabs!.x);
  expect(panel!.width).toBe(tabs!.width);
  expect(player.sync_status).toBe("synced");
  const story = `Rencontre E2E ${randomUUID()}`;
  await fillEncounter(page, story);
  await page.getByRole("tab", { name: "▤ Toutes les rencontres", exact: true }).click();
  await page.getByRole("tab", { name: "✎ Nouvelle rencontre", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Raconte ce moment *", exact: true })).toHaveValue(story);
  const response = page.waitForResponse((result) => result.url().endsWith("/api/encounters") && result.request().method() === "POST");
  await page.getByRole("button", { name: "Inscrire dans le journal →" }).click();
  const encounter = await (await response).json();
  expect(encounter.player_id).toBe(player.id);
  expect(encounter.sync_status).toBe("synced");
  await expect(page.getByText("Rencontre ajoutée au journal !", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "▤ Toutes les rencontres", exact: true }).click();
  await page.getByRole("combobox", { name: "Explorateur", exact: true }).selectOption(player.id);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").getByText(story, { exact: true })).toBeVisible();
  await expect(page.locator(".current-player .skin")).toBeVisible();
  await expect(page.getByRole("article").getByRole("img", { name: "Renard", exact: true })).toHaveAttribute("src", "/animals/fox.webp");
  await expect.poll(() => page.locator(".animal-image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("combobox", { name: "Espèce", exact: true }).selectOption("cow");
  await expect(page.getByRole("heading", { name: "Une page encore blanche" })).toBeVisible();
  await page.getByRole("button", { name: "Changer", exact: true }).click();
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choisir un explorateur" })).toBeVisible();
  const card = page.getByRole("button").filter({ has: page.getByText(username, { exact: true }) });
  for (let attempt = 0; attempt < 30 && await card.count() === 0; attempt++) {
    await expect(page.getByText("Recherche des explorateurs…", { exact: true })).toHaveCount(0);
    if (await card.count()) break;
    await page.getByRole("button", { name: "Suivant →", exact: true }).click();
  }
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Entrer dans le monde →" }).click();
  await expect(page.getByRole("heading", { name: "Le journal d’exploration", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("lost write response retains the key and recovers without duplicate", async ({ page }) => {
  const player = await createExplorer(page, `Retry_UI_${randomUUID().slice(0, 8)}`);
  const story = `Reprise E2E ${randomUUID()}`;
  await fillEncounter(page, story);
  let firstId = "";
  let firstKey = "";
  await page.route("**/api/encounters", async (route) => {
    firstKey = route.request().headers()["idempotency-key"];
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    firstId = (await response.json()).id;
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Inscrire dans le journal →" }).click();
  await expect(page.getByRole("alert")).toContainText("Connexion interrompue");
  await expect(page.getByRole("textbox", { name: "Raconte ce moment *", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Changer", exact: true })).toBeDisabled();
  const retry = page.waitForResponse((response) => response.url().endsWith("/api/encounters") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Réessayer la synchronisation" }).click();
  const response = await retry;
  expect(response.request().headers()["idempotency-key"]).toBe(firstKey);
  expect((await response.json()).id).toBe(firstId);
  await expect(page.getByText("Rencontre ajoutée au journal !", { exact: true })).toBeVisible();
  const list = await page.request.get(`/api/encounters?player_id=${player.id}`);
  expect(await list.json()).toHaveLength(1);
});

test("pseudo and uuid with surrounding spaces are trimmed so creation succeeds", async ({ page }) => {
  await page.route("**/api/skins/*", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ detail: { code: "skin_provider_unavailable", message: "Service de skins indisponible." } }),
  }));
  const username = `Trim_UI_${randomUUID().slice(0, 8)}`;
  const minecraftUuid = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle partie", exact: true }).click();
  await page.getByRole("textbox", { name: "Pseudo *", exact: true }).fill(`${username}   `);
  await page.getByRole("textbox", { name: "UUID Minecraft Java facultatif" }).fill(`${minecraftUuid} `);
  const response = page.waitForResponse((result) => result.url().endsWith("/api/players") && result.request().method() === "POST");
  await page.getByRole("button", { name: "Créer mon explorateur →" }).click();
  const creation = await response;
  expect(await creation.request().postDataJSON()).toEqual({ username, minecraft_uuid: minecraftUuid });
  const player = await creation.json();
  expect(player.username).toBe(username);
  expect(player.minecraft_uuid).toBe(minecraftUuid);
  expect(player.username_normalized).toBe(username.toLowerCase());
  await expect(page.getByRole("heading", { name: "Le journal d’exploration", exact: true })).toBeVisible();
});

test("mobile layout, validation, skin fallback and saved audio preferences", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "♫ Son activé" }).click();
  await page.getByRole("button", { name: "Couper le son" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "♪ Son coupé" })).toBeVisible();
  await page.getByRole("button", { name: "Nouvelle partie", exact: true }).click();
  await page.getByRole("textbox", { name: "Pseudo *", exact: true }).fill("ab");
  await page.getByRole("button", { name: "Créer mon explorateur →" }).click();
  await expect(page.getByRole("heading", { name: "Ton aventure commence ici" })).toBeVisible();
  await page.route("**/api/skins/*", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ detail: { code: "skin_provider_unavailable", message: "Service de skins indisponible." } }),
  }));
  await page.getByRole("textbox", { name: "UUID Minecraft Java facultatif" }).fill("069a79f4-44e9-4726-a5be-fca90e38aaf5");
  await page.getByRole("button", { name: "Voir le skin" }).click();
  await expect(page.getByRole("status")).toContainText("Apparence de remplacement");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const username = `Mobile_UI_${randomUUID().slice(0, 8)}`;
  await page.getByRole("textbox", { name: "Pseudo *", exact: true }).fill(username);
  await page.getByRole("button", { name: "Créer mon explorateur →" }).click();
  await expect(page.getByRole("heading", { name: "Le journal d’exploration", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const before = await page.locator(".world-image").getAttribute("src");
  await page.getByRole("combobox", { name: "Biome *", exact: true }).selectOption("desert");
  expect(await page.locator(".world-image").getAttribute("src")).not.toBe(before);
  await expect(page.locator(".world-image")).toHaveAttribute("src", "/biomes/desert.webp");
  await expect.poll(() => page.locator(".world-image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "▤ Toutes les rencontres", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Le journal des explorateurs", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
test(`world preparation stays visible for five seconds (${reducedMotion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  const time = new Date("2026-10-15T12:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle partie", exact: true }).click();
  await page.getByRole("textbox", { name: "Pseudo *", exact: true }).fill(`Timer_UI_${randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: "Créer mon explorateur →" }).click();
  await expect(page.locator(".loading-details small")).toContainText("3 / 3");
  await page.clock.runFor(4999);
  await expect(page.getByRole("heading", { name: "Préparation du monde" })).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByRole("heading", { name: "Le journal d’exploration", exact: true })).toBeVisible();
});
}

test("all ten backgrounds are real local game screenshots with attribution", async ({ page }) => {
  const response = await page.request.get("/biomes/credits.json");
  expect(response.ok()).toBe(true);
  const credits = await response.json();
  expect(credits.images).toHaveLength(10);
  await page.goto("/");
  for (const image of credits.images) {
    expect(image.page).toMatch(/^https:\/\/minecraft\.wiki\/w\/File:/);
    expect(image.contributor).toBeTruthy();
    const dimensions = await page.evaluate(async (src: string) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, `/biomes/${image.file}`);
    expect(dimensions.width).toBeGreaterThanOrEqual(1400);
    expect(dimensions.height).toBeGreaterThanOrEqual(800);
  }
  await expect(page.locator("body")).not.toContainText("✦");
});

test("each catalog species has a transparent, attributed animal portrait", async ({ page }) => {
  const species = await (await page.request.get("/api/species")).json();
  const credits = await (await page.request.get("/animals/credits.json")).json();
  expect(credits.images.map((image: { file: string }) => image.file).sort()).toEqual(
    species.map((animal: { id: string }) => `${animal.id}.webp`).sort(),
  );
  await page.goto("/");
  for (const image of credits.images) {
    expect(image.contributor).toBeTruthy();
    expect(image.page).toMatch(/^https:\/\/minecraft\.wiki\/w\/File:/);
    const pixels = await page.evaluate(async (file: string) => {
      const image = new Image();
      image.src = `/animals/${file}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D unavailable");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0, opaque = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) transparent++;
        if (data[i] === 255) opaque++;
      }
      return { transparent, opaque, total: canvas.width * canvas.height };
    }, image.file);
    expect(pixels.transparent).toBeGreaterThan(pixels.total * .1);
    expect(pixels.opaque).toBeGreaterThan(pixels.total * .1);
  }
});

for (const skin of [{ model: "classic", height: 64 }, { model: "slim", height: 64 }, { model: "classic", height: 32 }]) {
  test(`WebGL disabled still displays the actual ${skin.model} ${skin.height}px skin in CSS 3D`, async ({ page }) => {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
          if (type.includes("webgl")) return null;
          return Reflect.apply(getContext, this, [type, ...args]);
        },
      });
    });
    await page.goto("/");
    const png = await page.evaluate((height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D unavailable");
      context.fillStyle = "#ab1234";
      context.fillRect(0, 0, 64, height);
      return canvas.toDataURL().split(",")[1];
    }, skin.height);
    await page.route("**/api/test-skin.png", (route) => route.fulfill({
      status: 200, contentType: "image/png", body: Buffer.from(png, "base64"),
    }));
    await page.route("**/api/skins/*", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ minecraft_uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", model: skin.model, texture_url: "/api/test-skin.png" }),
    }));
    await page.getByRole("button", { name: "Nouvelle partie", exact: true }).click();
    await expect(page.locator(".css-skin")).toBeVisible();
    await page.getByRole("textbox", { name: "UUID Minecraft Java facultatif" }).fill("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    await page.getByRole("button", { name: "Voir le skin" }).click();
    await expect.poll(() => page.locator(".skin-face").first().evaluate(async (element: HTMLElement) => {
      const image = new Image();
      image.src = element.style.backgroundImage.slice(5, -2);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D unavailable");
      context.drawImage(image, 0, 0);
      return {
        face: Array.from(context.getImageData(8, 8, 1, 1).data),
        hat: Array.from(context.getImageData(40, 8, 1, 1).data),
        leftLeg: Array.from(context.getImageData(20, 52, 1, 1).data),
      };
    })).toEqual({ face: [171, 18, 52, 255], hat: [0, 0, 0, 0], leftLeg: [171, 18, 52, 255] });
    await expect(page.locator(".skin-cube")).toHaveCount(12);
    await expect(page.locator(".skin-cube").nth(2)).toHaveCSS("width", skin.model === "slim" ? "18px" : "24px");
    await expect(page.locator(".css-skin-model")).toHaveCSS("transform-style", "preserve-3d");
    await expect(page.getByText("Mode 3D compatible · WebGL indisponible")).toBeVisible();
    await expect(page.locator(".skin-warning")).toHaveCount(0);
  });
}
