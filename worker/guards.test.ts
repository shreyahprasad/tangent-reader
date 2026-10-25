import { describe, expect, it } from "vitest";
import { blockedAddress, checkLink, parseDns } from "./guards";

const SELF = "tangent-reader.tangent-reader.workers.dev";

describe("which links the Worker will fetch", () => {
  it("takes http and https links to a public host", () => {
    expect(checkLink("https://example.com/essay", SELF)).toEqual({ url: new URL("https://example.com/essay") });
    expect(checkLink("http://example.com:80/x", SELF)).toEqual({ url: new URL("http://example.com/x") });
    expect(checkLink("https://example.com:443/x", SELF)).toEqual({ url: new URL("https://example.com/x") });
  });

  it("refuses anything but http and https", () => {
    for (const link of ["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "gopher://example.com/", "not a link", ""]) {
      expect(checkLink(link, SELF), link).toEqual({ failure: { error: "bad_link" } });
    }
  });

  it("refuses a name or password in the link", () => {
    expect(checkLink("https://user:pw@example.com/", SELF)).toEqual({ failure: { error: "login_in_link" } });
    expect(checkLink("https://user@example.com/", SELF)).toEqual({ failure: { error: "login_in_link" } });
  });

  it("refuses any port but the usual ones", () => {
    for (const link of ["https://example.com:8443/", "http://example.com:22/", "http://example.com:6379/"]) {
      expect(checkLink(link, SELF), link).toEqual({ failure: { error: "port" } });
    }
  });

  it("refuses local names, and the Worker's own address", () => {
    for (const link of ["http://localhost/", "http://db.localhost/", "http://printer.local/", "http://metadata.google.internal/", "http://router.home.arpa/", "http://intranet/", `https://${SELF}/fetch`]) {
      expect(checkLink(link, SELF), link).toEqual({ failure: { error: "blocked" } });
    }
  });

  it("refuses those names with a trailing dot too", () => {
    for (const link of ["http://printer.local./", "http://metadata.google.internal./", `https://${SELF}./fetch`, "http://localhost./"]) {
      expect(checkLink(link, SELF), link).toEqual({ failure: { error: "blocked" } });
    }
  });

  it("refuses a private or special address written as an IP, in any of its spellings", () => {
    for (const link of ["http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/", "http://0.0.0.0/"]) {
      expect(checkLink(link, SELF), link).toEqual({ failure: { error: "blocked" } });
    }
  });

  it("takes a public address written as an IP", () => {
    expect(checkLink("https://1.1.1.1/", SELF)).toEqual({ url: new URL("https://1.1.1.1/") });
  });
});

describe("blocked addresses", () => {
  it("blocks private, loopback, link-local, metadata, shared and reserved IPv4", () => {
    for (const ip of ["0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "240.0.0.1", "255.255.255.255"]) {
      expect(blockedAddress(ip), ip).toBe(true);
    }
  });

  it("lets public IPv4 through", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.169.0.1"]) {
      expect(blockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks loopback, private, link-local, multicast and IPv4-carrying IPv6", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:8.8.8.8", "64:ff9b::a00:1", "2002:a00:1::", "2001:db8::1", "100::1"]) {
      expect(blockedAddress(ip), ip).toBe(true);
    }
  });

  it("lets public IPv6 through", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4009:81f::200e"]) {
      expect(blockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks what it cannot read as an address", () => {
    expect(blockedAddress("not-an-ip")).toBe(true);
    expect(blockedAddress("1.2.3")).toBe(true);
    expect(blockedAddress("1.2.3.256")).toBe(true);
  });
});

describe("DNS over HTTPS answers", () => {
  it("takes the addresses of the type asked for, past any CNAME", () => {
    const answer = { Status: 0, Answer: [{ type: 5, data: "cdn.example.net." }, { type: 1, data: "93.184.216.34" }, { type: 1, data: "93.184.216.35" }] };
    expect(parseDns(answer, "A")).toEqual(["93.184.216.34", "93.184.216.35"]);
    expect(parseDns({ Status: 0, Answer: [{ type: 28, data: "2606:2800:220:1::" }] }, "AAAA")).toEqual(["2606:2800:220:1::"]);
  });

  it("gives none for a name that does not exist, or a broken answer", () => {
    expect(parseDns({ Status: 3 }, "A")).toEqual([]);
    expect(parseDns({ Status: 0 }, "A")).toEqual([]);
    expect(parseDns(null, "A")).toEqual([]);
    expect(parseDns({ Status: 0, Answer: "nope" }, "A")).toEqual([]);
  });
});
