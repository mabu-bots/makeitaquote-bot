// ===== テスト: アバター取得の制限（ホスト許可リスト・サイズ上限） =====
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_AVATAR_BYTES,
  fetchAvatar,
  isAllowedAvatarUrl,
  isOverAvatarSizeLimit,
} from "../src/quote/avatar.js";

// 1x1 の透明 PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

interface FakeResponseOptions {
  body?: Buffer;
  contentLength?: string | null;
  contentType?: string | null;
}

function fakeResponse(opts: FakeResponseOptions = {}) {
  const body = opts.body ?? TINY_PNG;
  return {
    ok: true,
    headers: {
      get: (name: string): string | null => {
        if (name.toLowerCase() === "content-length") {
          return opts.contentLength === undefined
            ? String(body.byteLength)
            : opts.contentLength;
        }
        if (name.toLowerCase() === "content-type") {
          return opts.contentType === undefined
            ? "image/png"
            : opts.contentType;
        }
        return null;
      },
    },
    arrayBuffer: async (): Promise<ArrayBuffer> =>
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
  };
}

// globalThis.fetch を差し替えて fn を実行し、終わったら戻す
async function withStubbedFetch(
  stub: (url: string) => unknown,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) =>
    stub(String(input))) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("許可ホストは Discord CDN の https のみ", () => {
  assert.equal(
    isAllowedAvatarUrl("https://cdn.discordapp.com/avatars/1/abc.png"),
    true,
  );
  assert.equal(
    isAllowedAvatarUrl("https://media.discordapp.net/avatars/1/abc.png"),
    true,
  );
  assert.equal(
    isAllowedAvatarUrl("http://cdn.discordapp.com/avatars/1/abc.png"),
    false,
  );
  assert.equal(isAllowedAvatarUrl("https://example.com/avatar.png"), false);
  assert.equal(
    isAllowedAvatarUrl("https://cdn.discordapp.com.evil.example/avatar.png"),
    false,
  );
  assert.equal(isAllowedAvatarUrl("URLではない"), false);
});

test("Content-Length の上限判定", () => {
  assert.equal(isOverAvatarSizeLimit(String(MAX_AVATAR_BYTES)), false);
  assert.equal(isOverAvatarSizeLimit(String(MAX_AVATAR_BYTES + 1)), true);
  assert.equal(isOverAvatarSizeLimit(null), false);
});

test("Discord CDN の小さい画像は取得できる", async () => {
  await withStubbedFetch(
    () => fakeResponse(),
    async () => {
      const img = await fetchAvatar(
        "https://cdn.discordapp.com/avatars/1/abc.png",
      );
      assert.ok(img);
      assert.equal(img.width, 1);
    },
  );
});

test("許可リスト外のホストは fetch せず null を返す", async () => {
  let calls = 0;
  await withStubbedFetch(
    () => {
      calls += 1;
      return fakeResponse();
    },
    async () => {
      assert.equal(await fetchAvatar("https://example.com/avatar.png"), null);
    },
  );
  assert.equal(calls, 0);
});

test("Content-Length が上限を超えたら null を返す", async () => {
  await withStubbedFetch(
    () => fakeResponse({ contentLength: String(MAX_AVATAR_BYTES + 1) }),
    async () => {
      assert.equal(
        await fetchAvatar("https://cdn.discordapp.com/avatars/1/abc.png"),
        null,
      );
    },
  );
});

test("Content-Length が無くても実バイト数が上限を超えたら null を返す", async () => {
  await withStubbedFetch(
    () =>
      fakeResponse({
        body: Buffer.alloc(MAX_AVATAR_BYTES + 1),
        contentLength: null,
      }),
    async () => {
      assert.equal(
        await fetchAvatar("https://cdn.discordapp.com/avatars/1/abc.png"),
        null,
      );
    },
  );
});

test("Content-Type が画像でなければ null を返す", async () => {
  await withStubbedFetch(
    () => fakeResponse({ contentType: "text/html" }),
    async () => {
      assert.equal(
        await fetchAvatar("https://cdn.discordapp.com/avatars/1/abc.png"),
        null,
      );
    },
  );
});
