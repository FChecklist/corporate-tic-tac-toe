// The Corporate Games brand kit and the games bar are ONE shared set of files: this site's copies must equal the canonical files byte for byte
// (docs/boss/brand-kit, docs/boss/games-bar; the hashes below are what vendor.py and the games bar build print). If this fails, copy the files again; never edit a copy here.
// (Line endings do not count: git may check text files out with CRLF.)
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const sha = (f: string, text = true) => {
  let b = readFileSync(new URL("../public/" + f, import.meta.url));
  if (text) b = Buffer.from(b.toString("utf8").split(String.fromCharCode(13)).join(""));
  return createHash("sha256").update(b).digest("hex");
};
describe("the shared Corporate Games brand kit", () => {
  test("css and js are identical to the canonical copy", () => {
    expect(sha("tokens.css")).toBe("32566fe7a4bdd8d2880459d353dadff1f7d97f23ab7228d94313ef7e80017638");
    expect(sha("fonts.css")).toBe("94ca9271029ca0e0cdb269698e334dd8dedc001f5ca2c4a5d228a6dc11306a9c");
    expect(sha("components.css")).toBe("22196acdfbda615dfa2b0bf5bc61568155f9acfa94b979af36f1c3c11b46b786");
    expect(sha("console.css")).toBe("690b28be74be67487fd478350ff99e3b2d21bbabc2163e004ff94dfbfcbf5c0b");
    expect(sha("brandkit.js")).toBe("00dabcc77138e157a432705f18cc9145bf50164421bc08d173f7424d517f802b");
    expect(sha("theme-init.js")).toBe("8ff0eb6def5cf8a95b54a2b81738a022b7a7a2b2dc76325fed78c455e45c6d7f");
  });
  test("the two fonts are identical", () => {
    expect(sha("fonts/Inter-normal-400.woff2", false)).toBe("3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62");
    expect(sha("fonts/Fraunces-normal-500-700.woff2", false)).toBe("7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783");
  });
  test("the Tic Tac Toe logo files (app icons, favicons, share card) are the kit's, not an older logo", () => {
    const logos: Record<string, string> = {
      "icon-192.png": "092f6e552054da3430553b1fca6e869aea3eeb0b32b183a9162853267abfcdd6",
      "icon-512.png": "40ac3ae3b41868f31e3d830bc526b9c8216c62c8a6cc91c369619200b48bf498",
      "icon-maskable-192.png": "7d1a6cb70a43af32989b5cac8833aad6e3d4c159ddabb8e29e45c4f374d4ed7c",
      "icon-maskable-512.png": "4d5569a19f8392c20504de0d395e816c45bdcb0525f96216b9104d6d7bfdfb13",
      "apple-touch-icon.png": "82a213d89e638230ce8bd241d9ae80dba713ca11e3fb7fff295e7b15e42d83e1",
      "favicon-32.png": "12d526ab4862341250997c3d08d28a61a6de8a78d667ce13987d6fe68bd54fca",
      "favicon.ico": "185e31d8f97285de29fcc4d53d6a05370682e52ec2fa76c003f480c9e1410c81",
      "og-card.png": "d3afe5cacae239989947886075e89d30ea407edfd6477212e163b05461b2eba4",
    };
    for (const [f, h] of Object.entries(logos)) expect([f, sha(f, false)]).toEqual([f, h]);
    expect(sha("favicon.svg")).toBe("a550c95da0c19421f3ea726bcf6a4d232131236daa6a1a4ff065fa0e91fbab8e");
  });
});
describe("the shared Corporate Games bar", () => {
  test("gamesbar.js and gamesbar.css are identical to the canonical copy", () => {
    expect(sha("gamesbar.js")).toBe("16f02208af3c84cef63d81cdfcbc788f1baf23957ed71e912d44cafd4f881b98");
    expect(sha("gamesbar.css")).toBe("6b0311de98525de646e637a28102163dfecf9fde35b8befe0344a5e16fff8b5b");
  });
});
