import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Cloudflare Images uploads use guarded direct-upload endpoints", () => {
  const createRoute = source("app/api/admin/images/route.ts");
  const imageRoute = source("app/api/admin/images/[id]/route.ts");
  const service = source("lib/server/cloudflare-images.ts");

  assert.match(createRoute, /requirePermission\(request, permission\(input\.category\)\)/);
  assert.match(imageRoute, /requirePermission\(request, permission\(category\)\)/);
  assert.match(service, /images\/v2\/direct_upload/);
  assert.match(service, /CLOUDFLARE_IMAGES_API_TOKEN/);
  assert.doesNotMatch(createRoute, /CLOUDFLARE_IMAGES_API_TOKEN/);
});

test("image upload UI validates format and size before direct upload", () => {
  const component = source("components/cloudflare-image-upload.tsx");

  assert.match(component, /10 \* 1024 \* 1024/);
  assert.match(component, /image\/jpeg/);
  assert.match(component, /image\/png/);
  assert.match(component, /image\/webp/);
  assert.match(component, /image\/avif/);
  assert.match(component, /created\.uploadURL/);
  assert.match(component, /Vista previa de la imagen/);
});

test("tasks, events and announcements persist Cloudflare image identifiers", () => {
  const migration = source("migrations/0014_cloudflare_images_media.sql");
  const taskCreate = source("app/api/admin/tasks/route.ts");
  const taskUpdate = source("app/api/admin/tasks/[id]/route.ts");
  const notices = source("app/api/admin/notifications/route.ts");
  const taskUi = source("components/app-shell-v5.tsx");
  const noticeUi = source("components/admin-hub.tsx");

  assert.match(migration, /tasks ADD COLUMN image_id TEXT/);
  assert.match(migration, /tasks ADD COLUMN image_url TEXT/);
  assert.match(migration, /notifications ADD COLUMN media_id TEXT/);
  assert.match(taskCreate, /image_id/);
  assert.match(taskUpdate, /deleteCloudflareImage/);
  assert.match(notices, /media_id/);
  assert.match(taskUi, /category=\{form\.itemKind\}/);
  assert.match(noticeUi, /category="announcement"/);
  assert.doesNotMatch(noticeUi, /Archivo multimedia \(URL\)/);
});
