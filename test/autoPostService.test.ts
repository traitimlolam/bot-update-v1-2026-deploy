import {
  cleanCaption,
  DEFAULT_POSTER_NAME,
  POSTER_INFO_LINE,
} from "../src/services/autoPostService";

describe("autoPostService - Thông tin người đăng bài Fanpage", () => {
  it("người đăng bài mặc định luôn là Nguyễn Trọng Hiếu", () => {
    expect(DEFAULT_POSTER_NAME).toBe("Nguyễn Trọng Hiếu");
    expect(POSTER_INFO_LINE).toContain("Người đăng: Nguyễn Trọng Hiếu");
    expect(POSTER_INFO_LINE).toContain("Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254");
  });

  it("cleanCaption luôn chèn cố định thông tin người đăng Nguyễn Trọng Hiếu trước hashtag", () => {
    const rawContent = "Đất nghỉ dưỡng tuyệt đẹp tại Lạc Sơn Hòa Bình. View thung lũng xanh mướt, sổ đỏ trao tay.\n\n#datnghiduong #dathoabinh";

    const cleaned = cleanCaption(rawContent);
    expect(cleaned).toContain("Người đăng: Nguyễn Trọng Hiếu");
    expect(cleaned).toContain("Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254");

    // Vị trí: thông tin người đăng phải đứng trước hashtag
    const posterIdx = cleaned.indexOf("Người đăng: Nguyễn Trọng Hiếu");
    const hashtagIdx = cleaned.indexOf("#datnghiduong");
    expect(posterIdx).toBeGreaterThan(0);
    expect(hashtagIdx).toBeGreaterThan(posterIdx);
  });

  it("cleanCaption thay thế và loại bỏ hotline/người đăng cũ để không bị trùng lặp", () => {
    const rawContent = "Mảnh đất view đồi tuyệt đẹp, ô tô vào tận nơi.\n\n📞 Hotline / Zalo hỗ trợ tư vấn và xe đưa đón xem đất miễn phí: 0916.060.254\n\n#datnghiduong #dathoabinh";

    const cleaned = cleanCaption(rawContent);

    // Không còn dòng hotline cũ
    expect(cleaned).not.toContain("📞 Hotline / Zalo hỗ trợ tư vấn và xe đưa đón xem đất miễn phí:");
    // Luôn có thông tin người đăng chuẩn
    expect(cleaned).toContain("Người đăng: Nguyễn Trọng Hiếu");
    expect(cleaned).toContain("Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254");
  });

  it("cleanCaption tự động bổ sung hashtag nếu bài viết thiếu hashtag", () => {
    const rawContent = "Mảnh đất view đồi tuyệt đẹp, sổ đỏ sẵn công chứng ngay.";
    const cleaned = cleanCaption(rawContent);

    expect(cleaned).toContain("Người đăng: Nguyễn Trọng Hiếu");
    expect(cleaned).toContain("#datnghiduong");
    expect(cleaned).toContain("#dathoabinh");
  });
});
