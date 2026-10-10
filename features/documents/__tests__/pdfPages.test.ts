import { describe, expect, it } from "vitest";
import { formatPageList, isNoTextMapText } from "../extract/pdf";

describe("formatPageList", () => {
  it("collapses consecutive pages into ranges", () => {
    expect(formatPageList([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe("1–9");
    expect(formatPageList([2, 3, 4, 7])).toBe("2–4, 7");
    expect(formatPageList([5])).toBe("5");
  });
});

describe("isNoTextMapText", () => {
  // Page 9 of WP 6736/2020: Bengali set in Vrinda, whose embedded subset has
  // no text map, so the text layer is glyph codes (half of them C0 controls).
  const vrinda = "  !\"# $  %& \"!$'  ( # ) *+ )($ ";

  it("flags glyph codes with control characters", () => {
    expect(isNoTextMapText(vrinda)).toBe(true);
  });

  it("flags punctuation-only glyph codes", () => {
    expect(isNoTextMapText("! \" # $ % ' ( ) * + , - . / ! \" # $ % & ' ( )")).toBe(true);
  });

  it("leaves English, legacy bytes and Unicode Bengali alone", () => {
    expect(isNoTextMapText("The Customs Act, 1969 Section 32(2) and Section 180 of the Act")).toBe(false);
    expect(isNoTextMapText("h¡wm¡−cn p¤fË£j ®L¡VÑ q¡C−L¡VÑ ¢hi¡N (¢h−no j§m A¢d−rœ)")).toBe(false);
    expect(isNoTextMapText("বাংলাদেশ সুপ্রীম কোর্ট হাইকোর্ট বিভাগ ")).toBe(false);
  });

  it("ignores a few stray symbols", () => {
    expect(isNoTextMapText(" #")).toBe(false);
  });
});
