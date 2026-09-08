import {
  cleanCaption,
  HOTLINE_LINE,
  HOTLINE_PHONE,
  HOA_BINH_IMAGE_GROUPS,
  classifyImageCategory,
  searchContextImageUrl,
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

describe("autoPostService - Kho ảnh chuẩn Hòa Bình và Context Mapping", () => {
  it("kho ảnh có đủ 3 nhóm chủ đề chuẩn Hòa Bình với link trực tiếp .jpg/.png", () => {
    expect(HOA_BINH_IMAGE_GROUPS.SCENERY.length).toBeGreaterThanOrEqual(6);
    expect(HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE.length).toBeGreaterThanOrEqual(6);
    expect(HOA_BINH_IMAGE_GROUPS.CULTURE.length).toBeGreaterThanOrEqual(6);

    for (const group of [HOA_BINH_IMAGE_GROUPS.SCENERY, HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE, HOA_BINH_IMAGE_GROUPS.CULTURE]) {
      for (const u of group) {
        expect(u.startsWith("https://") || u.startsWith("http://")).toBe(true);
        expect(/\.(jpg|jpeg|png)/i.test(u)).toBe(true);
      }
    }
  });

  it("classifyImageCategory phân loại chính xác Nhóm 1 (SCENERY) cho bài đăng nghỉ dưỡng, sống xanh", () => {
    const text1 = "Buổi sáng thức dậy giữa mây ngàn, không gian sống xanh và ngôi nhà thứ hai (second home) ven đô tại Lạc Sơn";
    expect(classifyImageCategory(text1)).toBe("SCENERY");

    const text2 = "Thung lũng Mai Châu xanh ngát, hồ Thung Nai sông Đà nước trong vắt, nghỉ dưỡng cuối tuần thanh bình";
    expect(classifyImageCategory(text2)).toBe("SCENERY");
  });

  it("classifyImageCategory phân loại chính xác Nhóm 2 (INFRASTRUCTURE) cho bài đăng quy hoạch, cao tốc, pháp lý", () => {
    const text1 = "Đón sóng hạ tầng cao tốc Hòa Lạc - Hòa Bình mở rộng, bất động sản giá vùng trũng tăng trưởng";
    expect(classifyImageCategory(text1)).toBe("INFRASTRUCTURE");

    const text2 = "Sổ đỏ trao tay công chứng ngay trong ngày, pháp lý minh bạch an toàn, cơ hội đầu tư tích sản giữ tiền";
    expect(classifyImageCategory(text2)).toBe("INFRASTRUCTURE");

    const text3 = "Quy hoạch tổ hợp nghỉ dưỡng khoáng nóng Đồi Thung Lạc Sơn của Sun Group sắp khởi công";
    expect(classifyImageCategory(text3)).toBe("INFRASTRUCTURE");
  });

  it("classifyImageCategory phân loại chính xác Nhóm 3 (CULTURE) cho bài đăng văn hóa, lễ hội, cồng chiêng", () => {
    const text1 = "Tìm hiểu nét đẹp văn hóa cồng chiêng Mường Hòa Bình và lễ hội Khai Hạ truyền thống đầu xuân";
    expect(classifyImageCategory(text1)).toBe("CULTURE");

    const text2 = "Trải nghiệm không gian nhà sàn mộc mạc bên sườn đồi, thưởng thức ẩm thực cơm lam thịt nướng";
    expect(classifyImageCategory(text2)).toBe("CULTURE");
  });

  it("searchContextImageUrl trả về ảnh thuộc đúng nhóm và có tham số sig chống cache", async () => {
    // Nhóm 1
    const img1 = await searchContextImageUrl("nghỉ dưỡng", "MORNING", "ngôi nhà thứ hai second home sống xanh Mai Châu");
    expect(typeof img1).toBe("string");
    expect(img1).toContain("sig=");
    const rawUrl1 = img1.split("?")[0].split("&")[0];
    expect(HOA_BINH_IMAGE_GROUPS.SCENERY).toContain(rawUrl1);

    // Nhóm 2
    const img2 = await searchContextImageUrl("cao tốc", "EVENING", "đón sóng quy hoạch cao tốc Hòa Lạc hạ tầng đầu tư");
    expect(typeof img2).toBe("string");
    expect(img2).toContain("sig=");
    const rawUrl2 = img2.split("?")[0].split("&")[0];
    expect(HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE).toContain(rawUrl2);

    // Nhóm 3
    const img3 = await searchContextImageUrl("cồng chiêng", "MORNING", "lễ hội Khai Hạ cồng chiêng người Mường nhà sàn cơm lam");
    expect(typeof img3).toBe("string");
    expect(img3).toContain("sig=");
    const rawUrl3 = img3.split("?")[0].split("&")[0];
    expect(HOA_BINH_IMAGE_GROUPS.CULTURE).toContain(rawUrl3);
  });
});
