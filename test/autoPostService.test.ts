import {
  cleanCaption,
  HOTLINE_LINE,
  HOTLINE_PHONE,
} from "../src/services/autoPostService";

describe("autoPostService - Thông tin liên hệ bài đăng Fanpage", () => {
  it("HOTLINE_LINE chỉ chứa thông tin liên hệ và số điện thoại, tuyệt đối không chứa chữ Người đăng", () => {
    expect(HOTLINE_LINE).toBe(`Hotline / Zalo tư vấn và xe đưa đón xem đất: ${HOTLINE_PHONE}`);
    expect(HOTLINE_LINE).not.toContain("Người đăng");
    expect(HOTLINE_LINE).toContain("0916.060.254");
  });

  it("cleanCaption luôn chèn cố định hotline trước hashtag và không có chữ Người đăng", () => {
    const rawContent = "Đất nghỉ dưỡng tuyệt đẹp tại Lạc Sơn Hòa Bình. View thung lũng xanh mướt, sổ đỏ trao tay.\n\n#datnghiduong #dathoabinh";

    const cleaned = cleanCaption(rawContent);
    expect(cleaned).not.toContain("Người đăng");
    expect(cleaned).toContain("Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254");

    // Vị trí: hotline phải đứng trước hashtag
    const hotlineIdx = cleaned.indexOf("Hotline / Zalo tư vấn và xe đưa đón xem đất:");
    const hashtagIdx = cleaned.indexOf("#datnghiduong");
    expect(hotlineIdx).toBeGreaterThan(0);
    expect(hashtagIdx).toBeGreaterThan(hotlineIdx);
  });

  it("cleanCaption loại bỏ chữ Người đăng và hotline cũ để không bị trùng lặp", () => {
    const rawContent = "Mảnh đất view đồi tuyệt đẹp, ô tô vào tận nơi.\n\nNgười đăng: Nguyễn Trọng Hiếu\n📞 Hotline / Zalo hỗ trợ tư vấn và xe đưa đón xem đất miễn phí: 0916.060.254\n\n#datnghiduong #dathoabinh";

    const cleaned = cleanCaption(rawContent);

    // Không còn dòng Người đăng và không còn hotline cũ
    expect(cleaned).not.toContain("Người đăng");
    expect(cleaned).not.toContain("📞 Hotline / Zalo hỗ trợ tư vấn và xe đưa đón xem đất miễn phí:");
    // Luôn có thông tin hotline chuẩn
    expect(cleaned).toContain("Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254");
  });

  it("cleanCaption tự động bổ sung hashtag nếu bài viết thiếu hashtag", () => {
    const rawContent = "Mảnh đất view đồi tuyệt đẹp, sổ đỏ sẵn công chứng ngay.";
    const cleaned = cleanCaption(rawContent);

    expect(cleaned).not.toContain("Người đăng");
    expect(cleaned).toContain("Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254");
    expect(cleaned).toContain("#datnghiduong");
    expect(cleaned).toContain("#dathoabinh");
  });
});
