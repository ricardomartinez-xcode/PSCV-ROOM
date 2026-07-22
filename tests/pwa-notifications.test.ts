import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
) as { icons?: Array<{ purpose?: string; type?: string; sizes?: string }> };
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const bootstrap = readFileSync(
  new URL("../components/push-notifications-bootstrap.tsx", import.meta.url),
  "utf8",
);
const providers = readFileSync(new URL("../components/providers.tsx", import.meta.url), "utf8");
const deliveryCss = readFileSync(
  new URL("../components/notification-delivery.module.css", import.meta.url),
  "utf8",
);

test("notification action URLs remain on the application origin", () => {
  assert.match(serviceWorker, /function safeAppUrl/);
  assert.match(serviceWorker, /candidate\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /const targetUrl = safeAppUrl/);
  assert.match(providers, /function safeClientActionPath/);
  assert.match(providers, /candidate\.origin !== window\.location\.origin/);
});

test("service-worker mutations are same-origin and do not follow redirects", () => {
  assert.match(serviceWorker, /new URL\("\/api\/push\/pending", self\.location\.origin\)/);
  assert.match(serviceWorker, /mode: "same-origin"/);
  assert.match(serviceWorker, /redirect: "error"/);
  assert.match(bootstrap, /mode: "same-origin"/);
  assert.match(bootstrap, /redirect: "error"/);
});

test("system notifications share stable tags and service-worker navigation data", () => {
  assert.match(serviceWorker, /tag,/);
  assert.match(serviceWorker, /renotify: false/);
  assert.match(serviceWorker, /data: \{ url, notificationId: rawId \|\| null \}/);
  assert.match(providers, /registration\.showNotification/);
  assert.match(providers, /tag: `pscv-\$\{notification\.id\}`/);
  assert.match(providers, /data: \{ url: actionPath, notificationId: notification\.id \}/);
});

test("the manifest advertises Android-compatible raster and maskable icons", () => {
  assert.ok(manifest.icons?.length);
  assert.ok(
    manifest.icons?.some(
      (icon) => icon.type === "image/png" && icon.sizes === "192x192" && icon.purpose === "any",
    ),
  );
  assert.ok(
    manifest.icons?.some(
      (icon) => icon.type === "image/png" && icon.sizes === "512x512" && icon.purpose === "any",
    ),
  );
  assert.ok(
    manifest.icons?.some(
      (icon) => icon.type === "image/png" && icon.sizes === "512x512" && icon.purpose === "maskable",
    ),
  );
});

test("iOS installation and notification settings are accessible", () => {
  assert.match(layout, /appleWebApp:/);
  assert.match(layout, /<html lang="es-MX">/);
  assert.match(bootstrap, /navigator\.platform === "MacIntel" && navigator\.maxTouchPoints > 1/);
  assert.match(providers, /<details className=\{styles\.installHelp\}>/);
  assert.match(providers, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(deliveryCss, /min-height: 44px/);
  assert.match(deliveryCss, /:focus-visible/);
});


test("Web Push initialization fails closed with actionable diagnostics", () => {
  assert.match(bootstrap, /state !== "active"/);
  assert.match(bootstrap, /La aplicación no puede iniciar/);
  assert.match(bootstrap, /registerServiceWorker/);
  assert.match(bootstrap, /serviceWorker\.ready/);
  assert.match(bootstrap, /GET \/api\/push\/config/);
  assert.match(bootstrap, /PushManager\.subscribe/);
  assert.match(bootstrap, /POST \/api\/push\/subscribe/);
  assert.match(bootstrap, /diagnostic\.stack/);
  assert.match(bootstrap, /diagnostic\.browser/);
  assert.match(bootstrap, /diagnostic\.workerVersion/);
});
