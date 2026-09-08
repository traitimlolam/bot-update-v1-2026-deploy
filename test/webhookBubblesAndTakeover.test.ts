import { splitMessageIntoBubbles, isDuplicateMid, isPsidDebounced, resetWebhookDeduplicationForTest, MAX_BUBBLES_PER_TURN } from "../src/webhook/facebook";
import { isHumanTakeoverActive } from "../src/state/firestore";
import { Timestamp } from "@google-cloud/firestore";

describe("splitMessageIntoBubbles - Quy tắc băm tối đa 3 tin nhắn (Chỉ thị kỹ thuật Phần 3)", () => {
  it("chuỗi rỗng hoặc chỉ có khoảng trắng trả về mảng rỗng", () => {
    expect(splitMessageIntoBubbles("")).toEqual([]);
    expect(splitMessageIntoBubbles("   ")).toEqual([]);
  });

  it("1 đoạn văn bản trả về đúng 1 bong bóng", () => {
    const text = "Dạ em chào anh/chị, đất bên em ở Lạc Sơn Hòa Bình ạ.";
    expect(splitMessageIntoBubbles(text)).toEqual([text]);
  });

  it("2 đoạn phân tách bởi xuống dòng trả về 2 bong bóng", () => {
    const text = "Dạ em chào anh!\n\nĐất bên em ở Lạc Sơn, giá chỉ hơn 100 triệu một lô full thổ cư.";
    expect(splitMessageIntoBubbles(text)).toEqual([
      "Dạ em chào anh!",
      "Đất bên em ở Lạc Sơn, giá chỉ hơn 100 triệu một lô full thổ cư."
    ]);
  });

  it("3 đoạn phân tách bởi xuống dòng trả về 3 bong bóng", () => {
    const text = "Dạ em chào anh!\n\nĐất bên em ở Lạc Sơn, giá chỉ hơn 100 triệu một lô full thổ cư.\n\nEm có sẵn bảng giá và sơ đồ phân lô, anh cho em xin số Zalo để em gửi qua nhé.";
    const bubbles = splitMessageIntoBubbles(text);
    expect(bubbles.length).toBe(3);
    expect(bubbles[0]).toBe("Dạ em chào anh!");
    expect(bubbles[1]).toBe("Đất bên em ở Lạc Sơn, giá chỉ hơn 100 triệu một lô full thổ cư.");
    expect(bubbles[2]).toBe("Em có sẵn bảng giá và sơ đồ phân lô, anh cho em xin số Zalo để em gửi qua nhé.");
  });

  it("4 đoạn trở lên bắt buộc gộp lại tối đa 3 bong bóng, giữ câu xin số ở bong bóng thứ 3", () => {
    const text = "Chào anh!\n\nĐất ở Lạc Sơn Hòa Bình.\n\nĐã có sổ đỏ riêng từng lô công chứng ngay.\n\nAnh cho em xin số Zalo em gửi sơ đồ phân lô nhé.";
    const bubbles = splitMessageIntoBubbles(text);
    expect(bubbles.length).toBe(3);
    expect(bubbles[0]).toBe("Chào anh!");
    expect(bubbles[1]).toBe("Đất ở Lạc Sơn Hòa Bình.\n\nĐã có sổ đỏ riêng từng lô công chứng ngay.");
    expect(bubbles[2]).toBe("Anh cho em xin số Zalo em gửi sơ đồ phân lô nhé.");
  });

  it("5 đoạn ngắn cũng chỉ được tách thành tối đa 3 bong bóng", () => {
    const text = "Tin 1\nTin 2\nTin 3\nTin 4\nTin 5";
    const bubbles = splitMessageIntoBubbles(text);
    expect(bubbles.length).toBe(3);
    expect(bubbles[0]).toBe("Tin 1");
    expect(bubbles[2]).toBe("Tin 5");
  });
});

describe("isHumanTakeoverActive - Khóa mõm bot khi người thật tiếp quản (Chỉ thị kỹ thuật Phần 2)", () => {
  it("trả về false khi chưa từng có người thật nhắn (null/undefined)", () => {
    expect(isHumanTakeoverActive(null)).toBe(false);
    expect(isHumanTakeoverActive(undefined)).toBe(false);
    expect(isHumanTakeoverActive(0)).toBe(false);
  });

  it("trả về true khi người thật vừa nhắn cách đây dưới 10 phút", () => {
    const now = Date.now();
    const twoMinutesAgo = now - 2 * 60 * 1000;
    expect(isHumanTakeoverActive(twoMinutesAgo)).toBe(true);

    const nineMinutesAgo = now - 9 * 60 * 1000;
    expect(isHumanTakeoverActive(nineMinutesAgo)).toBe(true);
  });

  it("trả về false khi người thật đã nhắn cách đây quá 10 phút", () => {
    const now = Date.now();
    const elevenMinutesAgo = now - 11 * 60 * 1000;
    expect(isHumanTakeoverActive(elevenMinutesAgo)).toBe(false);

    const oneHourAgo = now - 60 * 60 * 1000;
    expect(isHumanTakeoverActive(oneHourAgo)).toBe(false);
  });

  it("hỗ trợ cả đối tượng Firestore Timestamp", () => {
    const nowMs = Date.now();
    const recentTimestamp = Timestamp.fromMillis(nowMs - 3 * 60 * 1000);
    expect(isHumanTakeoverActive(recentTimestamp)).toBe(true);

    const oldTimestamp = Timestamp.fromMillis(nowMs - 15 * 60 * 1000);
    expect(isHumanTakeoverActive(oldTimestamp)).toBe(false);
  });
});

describe("isDuplicateMid - Chống Facebook retry webhook trùng lặp message_id (mid)", () => {
  beforeEach(() => {
    resetWebhookDeduplicationForTest();
  });

  it("mid rỗng hoặc undefined không coi là duplicate", async () => {
    expect(await isDuplicateMid(undefined)).toBe(false);
    expect(await isDuplicateMid("")).toBe(false);
  });

  it("lần đầu nhận mid trả về false, lần 2 với cùng mid trả về true (duplicate)", async () => {
    const mid = "m_mid_test_123456";
    expect(await isDuplicateMid(mid)).toBe(false);
    expect(await isDuplicateMid(mid)).toBe(true);
  });

  it("hai mid khác nhau đều được chấp nhận độc lập", async () => {
    expect(await isDuplicateMid("mid_a")).toBe(false);
    expect(await isDuplicateMid("mid_b")).toBe(false);
    expect(await isDuplicateMid("mid_a")).toBe(true);
    expect(await isDuplicateMid("mid_b")).toBe(true);
  });
});

describe("isPsidDebounced - Chống bão webhook Meta khi khách bấm quảng cáo (Debounce 4s)", () => {
  beforeEach(() => {
    resetWebhookDeduplicationForTest();
  });

  it("psid rỗng không debounce", async () => {
    expect(await isPsidDebounced("")).toBe(false);
  });

  it("lần đầu tiếp nhận PSID trả về false (không debounce)", async () => {
    expect(await isPsidDebounced("PSID_12345")).toBe(false);
  });

  it("sự kiện thứ 2 trong vòng 4 giây cùng PSID lập tức bị debounce (trả về true)", async () => {
    const psid = "PSID_NGUYEN_THUY";
    expect(await isPsidDebounced(psid, 4000)).toBe(false);
    // Bắn tiếp sự kiện thứ 2 sau vài ms
    expect(await isPsidDebounced(psid, 4000)).toBe(true);
    // Bắn tiếp sự kiện thứ 3
    expect(await isPsidDebounced(psid, 4000)).toBe(true);
  });

  it("hai PSID khác nhau không chặn lẫn nhau", async () => {
    expect(await isPsidDebounced("PSID_KHACH_A", 4000)).toBe(false);
    expect(await isPsidDebounced("PSID_KHACH_B", 4000)).toBe(false);
  });

  it("khống chế MAX_BUBBLES_PER_TURN cố định là 3 bong bóng", () => {
    expect(MAX_BUBBLES_PER_TURN).toBe(3);
  });
});
