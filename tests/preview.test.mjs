import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  previewImage,
  waitForPreview,
  prunePreviews,
  PREVIEW_MAX_BYTES
} from "../build/preview.js";

test("preview delivery checks correlation, PNG dimensions, size and confines reads to artifacts", (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "AE preview "))
  );
  const folder = path.join(root, "previews");
  fs.mkdirSync(folder);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = "11111111-1111-4111-8111-111111111111";
  const response = {
    requestId: id,
    data: { artifact: `${id}.png`, width: 1, height: 1 }
  };
  const file = path.join(folder, `${id}.png`);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64"
  );
  fs.writeFileSync(file, png);
  assert.equal(previewImage(root, response).type, "image");
  assert.throws(
    () =>
      previewImage(root, {
        ...response,
        data: { ...response.data, artifact: "../secret.png" }
      }),
    /identity/
  );
  assert.throws(
    () =>
      previewImage(root, { ...response, data: { ...response.data, width: 2 } }),
    /dimensions/
  );
  fs.writeFileSync(file, "Not a PNG");
  assert.throws(() => previewImage(root, response), /truncated/);
  fs.writeFileSync(file, Buffer.alloc(PREVIEW_MAX_BYTES + 1));
  assert.throws(() => previewImage(root, response), /16 MiB/);
  fs.writeFileSync(file, png);
  fs.writeFileSync(path.join(folder, "user.png"), png);
  fs.utimesSync(file, 0, 0);
  fs.utimesSync(path.join(folder, "user.png"), 0, 0);
  prunePreviews(root);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(folder, "user.png")), true);
});

test("deferred PNG publication waits for IEND and expires without recapturing", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "AE deferred preview "))
  );
  const folder = path.join(root, "previews");
  fs.mkdirSync(folder);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = "22222222-2222-4222-8222-222222222222";
  const response = {
    requestId: id,
    data: { artifact: `${id}.png`, width: 1, height: 1 }
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64"
  );
  const file = path.join(folder, `${id}.png`);
  fs.writeFileSync(file, png.subarray(0, 40));
  const timer = setTimeout(() => fs.writeFileSync(file, png), 80);
  t.after(() => clearTimeout(timer));
  assert.equal(
    (await waitForPreview(root, response, 1000)).data,
    png.toString("base64")
  );
  fs.unlinkSync(file);
  await assert.rejects(waitForPreview(root, response, 80), /ENOENT/);
});
