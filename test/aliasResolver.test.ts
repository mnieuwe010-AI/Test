import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCompanyName } from "../src/canonicalize/aliasResolver.js";
import { Repository } from "../src/db/repository.js";

describe("resolveCompanyName", () => {
  let repo: Repository;

  beforeEach(() => {
    repo = new Repository(":memory:");
  });

  afterEach(() => {
    repo.close();
  });

  it("maakt een nieuwe canonieke naam aan bij de eerste keer dat een bedrijf gezien wordt", () => {
    const result = resolveCompanyName(repo, "Wilko Fruit B.V.", "sender");
    expect(result.reason).toBe("new_company");
    expect(result.isNewCompany).toBe(true);
    expect(result.needsConfirmation).toBe(true);
    expect(result.canonicalName).toBe("Wilko Fruit B.V");
  });

  it("sanitized het echte '/'-geval uit de aangeleverde CMR-bon tot een geldige mapnaam", () => {
    const result = resolveCompanyName(repo, "Jacobs / Cooperatie Hoogstraten", "receiver");
    expect(result.canonicalName).toBe("Jacobs - Cooperatie Hoogstraten");
    expect(result.canonicalName).not.toMatch(/\//);
  });

  it("hergebruikt dezelfde canonieke naam bij een exacte herhaalde naam", () => {
    const first = resolveCompanyName(repo, "Wilko Fruit B.V.", "sender");
    const second = resolveCompanyName(repo, "Wilko Fruit B.V.", "sender");

    expect(second.reason).toBe("exact_match");
    expect(second.canonicalName).toBe(first.canonicalName);
  });

  it("matcht een schrijfvariant fuzzy op de bestaande canonieke naam i.p.v. een nieuwe map te maken", () => {
    const first = resolveCompanyName(repo, "Wilko Fruit B.V.", "sender");
    const variant = resolveCompanyName(repo, "WILKO FRUIT BV", "sender");

    expect(variant.reason).toBe("fuzzy_match");
    expect(variant.canonicalName).toBe(first.canonicalName);
    expect(variant.needsConfirmation).toBe(true);
  });

  it("behandelt duidelijk verschillende bedrijven als aparte partijen", () => {
    const a = resolveCompanyName(repo, "Wilko Fruit B.V.", "sender");
    const b = resolveCompanyName(repo, "De Mooij Zoetermeer B.V.", "both");

    expect(a.canonicalName).not.toBe(b.canonicalName);
  });

  it("een al bevestigde (geseede) alias heeft geen bevestiging meer nodig", () => {
    repo.insertAlias("Wilko Fruit B.V.", "Wilko Fruit B.V.", "both", true);
    const result = resolveCompanyName(repo, "Wilko Fruit B.V.", "sender");

    expect(result.reason).toBe("exact_match");
    expect(result.needsConfirmation).toBe(false);
  });
});
