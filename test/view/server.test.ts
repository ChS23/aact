import { startServer, viewAuthState } from "../../packages/view/src/server";

const TOKEN = "test-token";

const authFor = (url: string, cookie?: string) =>
  viewAuthState(
    new URL(url, "http://localhost"),
    new Headers(cookie ? { cookie } : {}),
    TOKEN,
  );

describe("aact view server auth", () => {
  it("authorizes query-token requests and marks them for cookie minting", () => {
    expect(authFor(`/?token=${TOKEN}`)).toEqual({
      ok: true,
      shouldSetCookie: true,
    });
  });

  it("authorizes existing session cookies without minting a new cookie", () => {
    expect(authFor("/", `other=1; aact_view_token=${TOKEN}`)).toEqual({
      ok: true,
      shouldSetCookie: false,
    });
  });

  it("rejects requests without a valid token or cookie", () => {
    expect(authFor("/")).toEqual({ ok: false, shouldSetCookie: false });
    expect(authFor("/?token=wrong")).toEqual({
      ok: false,
      shouldSetCookie: false,
    });
    expect(authFor("/", "aact_view_token=wrong")).toEqual({
      ok: false,
      shouldSetCookie: false,
    });
  });
});

describe("aact view server startup", () => {
  it("exposes the authenticated URL to listhen before it opens a browser", async () => {
    const server = await startServer({
      authToken: TOKEN,
      initialEnvelope: {} as never,
      noOpen: true,
      port: 0,
    });

    const [url] = await server.listener.getURLs();
    expect(url?.url).toContain(`/?token=${TOKEN}`);

    await server.close();
  });
});
