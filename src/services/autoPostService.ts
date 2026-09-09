import { getDb } from "../state/firestore";

const ROUTER_API_KEY = process.env.AI_ROUTER_API_KEY || process.env.ROUTER_API_KEY || "sk-or-v1-fallback";
const ROUTER_BASE_URL = process.env.AI_ROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const MODEL_NAME = process.env.AI_ROUTER_MODEL || "google/gemini-2.5-flash";
const GRAPH_BASE_URL = "https://graph.facebook.com/v21.0";
const AI_TIMEOUT_MS = 25000;

/**
 * 5 chủ đề xoay vòng chất lượng cao bám sát thế mạnh thực tế của Hòa Bình:
 * - PLANNING_INFRASTRUCTURE: Tầm nhìn quy hoạch & hạ tầng giao thông kết nối
 * - BIG_INVESTORS: Làn sóng các đại bàng bất động sản đổ bộ (Sun Group Đồi Thung, sinh thái...)
 * - CASH_FLOW_ASSET: Xu hướng dịch chuyển dòng tiền và tích sản an toàn ven đô
 * - ECO_LIFESTYLE: Địa thế phong thủy và phong cách sống sinh thái (second home)
 * - LOCAL_CULTURE: Văn hóa, con người và bản sắc bản địa (văn hóa Mường, ẩm thực...)
 */
export type DailyTopic =
  | "PLANNING_INFRASTRUCTURE"
  | "BIG_INVESTORS"
  | "CASH_FLOW_ASSET"
  | "ECO_LIFESTYLE"
  | "LOCAL_CULTURE";

// Duy trì tương thích ngược với MORNING, NOON, EVENING cho các API hoặc test cũ
export type PostTopic =
  | "MORNING"
  | "NOON"
  | "EVENING"
  | DailyTopic;

export const DAILY_TOPICS: DailyTopic[] = [
  "PLANNING_INFRASTRUCTURE",
  "BIG_INVESTORS",
  "CASH_FLOW_ASSET",
  "ECO_LIFESTYLE",
  "LOCAL_CULTURE",
];

/**
 * Lấy chủ đề xoay vòng cho ngày (chu kỳ 5 ngày xoay vòng đều đặn)
 */
export function getRotatingDailyTopic(date: Date = new Date()): DailyTopic {
  const vnTime = new Date(date.getTime() + 7 * 3600 * 1000);
  const startOfYear = new Date(Date.UTC(vnTime.getUTCFullYear(), 0, 1));
  const diffMs = vnTime.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diffMs / (24 * 3600 * 1000));
  return DAILY_TOPICS[Math.abs(dayOfYear) % DAILY_TOPICS.length];
}

export const HOTLINE_PHONE = "0916.060.254";
export const HOTLINE_LINE = `Hotline / Zalo tư vấn và xe đưa đón xem đất: ${HOTLINE_PHONE}`;
export const POSTER_INFO_LINE = HOTLINE_LINE;

export interface GeneratedPost {
  caption: string;
  imageQuery: string;
}

export interface PublishResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface AutoPostResult {
  success: boolean;
  postId?: string;
  topic: PostTopic;
  caption?: string;
  imageUrl?: string;
  error?: string;
}

// Căn cứ dữ liệu thực tế từ knowledgeBase.ts
const AREA_KNOWLEDGE_BASE = `
- Địa điểm: Xã Lạc Sơn, tỉnh Hòa Bình (cũ, nay chuyển về tỉnh Phú Thọ). Vị trí giáp ranh Thanh Sơn, Phú Thọ.
- Khoảng cách di chuyển: Cách Big C Thăng Long (Hà Nội) khoảng 70 - 80km (chỉ hơn 1 giờ lái xe ô tô).
- Quy mô dự án: Khu đất phân lô đã có trích lục bản đồ, đường bê tông rộng 5 - 7m, 2 ô tô tránh nhau thoải mái.
- Diện tích từng lô: Từ 100m2 đến 120m2, mặt tiền rộng 5m - 6m vuông vắn.
- Pháp lý: 100% full thổ cư (ONT), sổ đỏ sẵn có, công chứng sang tên ngay trong ngày.
- Giá bán: Từ 1,5 - 2 triệu/m2 (tổng giá trị chỉ từ hơn 100 triệu đến 200 triệu đồng/lô).
- Chi phí phát sinh: Giá trọn gói, bên bán bao toàn bộ chi phí đo đạc, thuế và phí sang tên sổ đỏ.
- Dịch vụ hỗ trợ: Có xe ô tô đưa đón khách hàng đi xem đất thực tế hoàn toàn miễn phí vào các ngày cuối tuần.
`.trim();

/**
 * Kho ảnh phong cảnh Hòa Bình thực tế chọn lọc kỹ lưỡng theo 3 nhóm chủ đề:
 * - Nhóm 1 (SCENERY): Thiên nhiên, cảnh đẹp thung lũng, đồi núi, sương sớm, sông nước, không gian xanh
 * - Nhóm 2 (INFRASTRUCTURE): Công trình, cao tốc, thủy điện, quy hoạch, đường giao thông, đại bàng đầu tư
 * - Nhóm 3 (CULTURE): Văn hóa dân tộc, lễ hội Khai Hạ, cồng chiêng, nhà sàn, ẩm thực bản địa
 */
export type HoaBinhImageCategory = "SCENERY" | "INFRASTRUCTURE" | "CULTURE";

export const HOA_BINH_IMAGE_GROUPS: Record<HoaBinhImageCategory, string[]> = {
  SCENERY: [
    "https://bvhttdl.mediacdn.vn/291773308735864832/2021/6/17/img2149-16239162985791986518115.jpg",
    "https://statics.vinpearl.com/thung-nai-hoa-binh-2_1629344400.jpg",
    "https://baovanhoa.vn/Portals/0/Images/vannguyen/2024/02/16/thung-lung-mai-chau-7.jpg",
    "https://mia.vn/media/uploads/blog-du-lich/deo-thung-khe-1-1638202932.jpg",
    "https://toquoc.mediacdn.vn/280518851207788544/2020/10/22/thung-lung-mai-chau-hoa-binh-16033486337581177651083.jpg",
    "https://vietnamnomad.com/wp-content/uploads/2021/04/Deo-Da-Trang-Hoa-Binh-Vietnamnomad-01.jpg",
    "https://file1.dangcongsan.vn/data/0/images/2023/11/14/upload_174/thung-nai.jpg",
  ],

  INFRASTRUCTURE: [
    "https://vnanet.vn/Data/Articles/2023/10/01/7027170/cong-trinh-thuy-dien-hoa-binh-bieu-tuong-cua-tinh-huu-nghi-viet-nga-7027170.jpg",
    "https://moit.gov.vn/upload/2005504/20230608/6cbe22b5-31ba-449e-ba6a-3932824cfcbb.jpg",
    "https://baoxaydung.com.vn/stores/news_dataimages/2023/082023/24/11/cau-hoa-binh-3.jpg",
    "https://cdnmedia.baotintuc.vn/Upload/4p05qdkXToL5iG2kkg/files/2023/09/cau-hoa-binh.jpg",
    "https://bcp.cdnchinhphu.vn/334894974524682240/2023/5/11/cao-toc-16837947702811440842790.jpg",
    "https://img.tapchicongthuong.vn/tcct-media/23/9/28/khoi-cong-cao-toc-hoa-binh-moc-chau.jpg",
  ],

  CULTURE: [
    "https://cly.1cdn.vn/2023/01/29/cdn-congly-vn_le-hoi-khai-ha-dac-sac-rieng-cua-dan-toc-muong-o-hoa-binh-hinh-anh01657009134.jpg",
    "https://images.baodantoc.vn/uploads/lethihongphuc/2023/1/28/c9d4d56b-1539-4da5-a-16746374630901356692072.jpg",
    "https://imgchinhsachcuocsong.vnanet.vn/MediaUpload/Org/2024/02/17/145332-thumbstand-1.jpg",
    "https://hoinhap.vanhoavaphattrien.vn/uploads/2025/04/09/1-chieng-muong-1744174934.jpg",
    "https://nhn.1cdn.vn/2023/08/05/img_8081.jpg",
    "https://maichautourist.com/assets/uploads/blog/nha-san-so-6-ban-lac-mai-chau-hoa-binh-1.JPG",
    "https://galatravel.vn/pic/destination/images/com-lam-mai-chau.jpg",
    "https://viptrip.vn/public/upload/news/com-lam-mai-chau_19-10-2022_425592055.jpg",
  ],
};

export const HOA_BINH_CURATED_POOLS: Record<PostTopic, string[]> = {
  MORNING: HOA_BINH_IMAGE_GROUPS.SCENERY,
  NOON: HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE,
  EVENING: HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE,
  PLANNING_INFRASTRUCTURE: HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE,
  BIG_INVESTORS: HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE,
  CASH_FLOW_ASSET: HOA_BINH_IMAGE_GROUPS.INFRASTRUCTURE,
  ECO_LIFESTYLE: HOA_BINH_IMAGE_GROUPS.SCENERY,
  LOCAL_CULTURE: HOA_BINH_IMAGE_GROUPS.CULTURE,
};

/**
 * Phân loại nội dung bài viết để chọn nhóm ảnh ăn khớp nhất
 */
export function classifyImageCategory(content: string, topic?: PostTopic): HoaBinhImageCategory {
  const norm = (content || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  // Nhóm 3: Văn hóa dân tộc, lễ hội Khai Hạ, cồng chiêng, nhà sàn, ẩm thực bản địa
  const isCulture = /(van hoa|le hoi|khai ha|cong chieng|nha san|ban sac|truyen thong|am thuc|com lam|thit nuong|nguoi muong|nguoi thai|trai nghiem|doi song ban dia|con nguoi)/.test(norm);
  if (isCulture) {
    return "CULTURE";
  }

  // Nhóm 2: Pháp lý, giá trị đất, quy hoạch, cao tốc, thủy điện, hạ tầng, đại bàng đầu tư, Sun Group, Đồi Thung
  const isInfrastructure = /(phap ly|gia tri dat|quy hoach|cao toc|ha tang|thuy dien|cong trinh|dau tu|tich san|giu tien|bien do|sinh loi|sun group|doi thung|tang gia|don song|giao thong|so do|tho cu|cau hoa binh|tuong dai|dai bang|do bo|tap doan)/.test(norm);
  if (isInfrastructure) {
    return "INFRASTRUCTURE";
  }

  // Nhóm 1: Nghỉ dưỡng, sống xanh, nhà vườn cuối tuần, thiên nhiên, thung lũng, hồ Thung Nai, đồi Lạc Sơn, second home
  const isScenery = /(nghi duong|song xanh|khong gian xanh|nha vuon|second home|cuoi tuan|thien nhien|thung lung|suong som|view doi|suoi|thac|thung nai|mai chau|thung khe|da trang|lac son|phong thuy|khi hau)/.test(norm);
  if (isScenery) {
    return "SCENERY";
  }

  // Fallback theo topic
  if (topic === "LOCAL_CULTURE") return "CULTURE";
  if (topic === "PLANNING_INFRASTRUCTURE" || topic === "BIG_INVESTORS" || topic === "CASH_FLOW_ASSET" || topic === "NOON" || topic === "EVENING") {
    return "INFRASTRUCTURE";
  }
  return "SCENERY";
}

/**
 * Kho góc nhìn đa dạng cho 5 chủ đề xoay vòng:
 * Mỗi chủ đề gồm 3 góc nhìn mở đầu khác nhau: đặt câu hỏi, góc nhìn thị trường, chia sẻ trải nghiệm thực tế.
 */
const TOPIC_ANGLES: Record<PostTopic, Array<{ prompt: string; keywords: string }>> = {
  PLANNING_INFRASTRUCTURE: [
    {
      prompt: `CHỦ ĐỀ: Tầm nhìn quy hoạch và hạ tầng giao thông kết nối Hòa Bình.
GÓC NHÌN MỞ ĐẦU: Góc nhìn thị trường sắc bén về sự bứt phá của hạ tầng kết nối phía Tây thủ đô.
NỘI DUNG: Phân tích tiến độ mở rộng cao tốc Hòa Lạc - Hòa Bình lên 6 làn xe, tuyến cao tốc Hòa Bình - Mộc Châu đang tăng tốc thi công, các công trình cầu cạn và đường liên kết vùng. Thời gian di chuyển từ trung tâm Hà Nội về Hòa Bình được rút ngắn xuống dưới 1 giờ. Hạ tầng giao thông đi trước mở đường, tạo cú hích đòn bẩy khổng lồ cho kinh tế và giá trị bất động sản toàn vùng.`,
      keywords: "cao tốc Hòa Lạc Hòa Bình đường liên kết vùng",
    },
    {
      prompt: `CHỦ ĐỀ: Hạ tầng giao thông kết nối - Đòn bẩy đưa bất động sản Hòa Bình bứt phá.
GÓC NHÌN MỞ ĐẦU: Đặt câu hỏi kích thích suy ngẫm: "Tại sao các nhà đầu tư kinh nghiệm luôn đi trước đón đầu ở những nơi có hạ tầng giao thông lớn đi qua?"
NỘI DUNG: Phân tích các trục kết nối huyết mạch: cao tốc Hòa Lạc - Hòa Bình kết nối thông suốt với cao tốc Hòa Bình - Mộc Châu. Giao thông thuận tiện giúp việc đi lại, giao thương hàng hóa và du lịch cuối tuần trở nên dễ dàng hơn bao giờ hết. Khi đường lớn mở ra, tiềm năng gia tăng giá trị tài sản là điều tất yếu.`,
      keywords: "cầu Hòa Bình sông Đà cao tốc",
    },
    {
      prompt: `CHỦ ĐỀ: Trực tiếp mục sở thị sự thay đổi từng ngày của hạ tầng giao thông Hòa Bình.
GÓC NHÌN MỞ ĐẦU: Chia sẻ trải nghiệm thực tế từ một chuyến đi khảo sát thực địa từ Hà Nội về Hòa Bình cuối tuần qua.
NỘI DUNG: Cung đường cao tốc thông thoáng, những cây cầu cạn và tuyến đường liên kết vùng đang ngày đêm hối hả thi công. Diện mạo đô thị và nông thôn vùng ven đang khoác lên tấm áo mới hiện đại. Khoảng cách địa lý dường như bị xóa nhòa, biến vùng đất cửa ngõ Tây Bắc thành điểm đến hấp dẫn nhất ven đô.`,
      keywords: "giao thông Hòa Bình cầu cạn đường mới",
    },
  ],

  BIG_INVESTORS: [
    {
      prompt: `CHỦ ĐỀ: Làn sóng các đại bàng bất động sản đổ bộ đánh thức tiềm năng Hòa Bình.
GÓC NHÌN MỞ ĐẦU: Góc nhìn thị trường toàn cảnh về dòng vốn đầu tư nghìn tỷ từ các tập đoàn lớn.
NỘI DUNG: Điểm mặt các tổ hợp dự án nghỉ dưỡng quy mô lớn, tiêu biểu là quần thể nghỉ dưỡng khoáng nóng Đồi Thung (Lạc Sơn) của Sun Group cùng các khu đô thị sinh thái đang làm thay đổi căn bản diện mạo địa phương. Hòa Bình đang chuyển mình mạnh mẽ trở thành trung tâm du lịch chăm sóc sức khỏe hàng đầu miền Bắc.`,
      keywords: "Sun Group Đồi Thung Lạc Sơn Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Điều gì tạo nên sức hút để các đại bàng địa ốc đổ bộ về Hòa Bình?
GÓC NHÌN MỞ ĐẦU: Đặt câu hỏi chiến lược: "Tại sao những tên tuổi lớn như Sun Group lại chọn vùng đất Hòa Bình để đặt những đại dự án quy mô nghìn tỷ?"
NỘI DUNG: Lợi thế tự nhiên độc bản với nguồn khoáng nóng quý giá, khí hậu mát lành quanh năm và địa hình bán sơn địa thơ mộng. Khi các ông lớn tiên phong kiến tạo hệ sinh thái du lịch cao cấp, hạ tầng và giá trị quỹ đất vệ tinh xung quanh sẽ được nâng tầm vượt bậc.`,
      keywords: "dự án sinh thái nghỉ dưỡng Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Khảo sát thực địa quanh khu vực đại dự án khoáng nóng Đồi Thung Lạc Sơn.
GÓC NHÌN MỞ ĐẦU: Trải nghiệm thực tế khi tận mắt chứng kiến không khí phát triển sôi động tại địa phương.
NỘI DUNG: Đường sá được mở rộng, quy hoạch bài bản, người dân địa phương phấn khởi đón làn sóng đầu tư mới. Bài học từ các thị trường đi trước như Sa Pa hay Phú Quốc cho thấy: sở hữu quỹ đất pháp lý chuẩn chỉnh đón đầu ngay giai đoạn đầu của các đại dự án luôn mang lại lợi thế vượt trội.`,
      keywords: "khảo sát đất Lạc Sơn Hòa Bình",
    },
  ],

  CASH_FLOW_ASSET: [
    {
      prompt: `CHỦ ĐỀ: Bài toán dòng tiền - Tích sản đất nền ven đô an toàn trước lạm phát.
GÓC NHÌN MỞ ĐẦU: Góc nhìn tài chính sắc bén về sự dịch chuyển dòng vốn đầu tư hiện nay.
NỘI DUNG: Trong bối cảnh giá chung cư nội đô tăng cao và lãi suất tiền gửi chưa đủ bù đắp lạm phát dài hạn, dòng tiền thông minh đang tìm về các vùng trũng giá ven đô có sổ đỏ pháp lý rõ ràng. Đất nền Hòa Bình với mức giá hợp lý là kênh tích lũy tài sản vững chắc, vừa giữ tiền an toàn vừa đón biên độ sinh lời bền vững.`,
      keywords: "đất nền sổ đỏ Hòa Bình giá vùng trũng",
    },
    {
      prompt: `CHỦ ĐỀ: Đâu là kênh trú ẩn dòng tiền an toàn và sinh lời bền vững cho tương lai?
GÓC NHÌN MỞ ĐẦU: Đặt câu hỏi thực tế với các gia đình: "Nên tiếp tục giữ tiền gửi tiết kiệm hay chuyển hóa thành tài sản đất đai có sổ đỏ cầm tay?"
NỘI DUNG: Phân tích ưu thế vượt trội của việc tích sản đất nền có pháp lý hoàn chỉnh: không lo mất giá vì lạm phát, chi phí vốn đầu tư ban đầu vừa tầm, quyền sở hữu vĩnh viễn và không chịu áp lực đòn bẩy tài chính. Một mảnh đất sẵn sổ đỏ luôn mang lại sự yên tâm tuyệt đối.`,
      keywords: "tích sản đất nền an toàn Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Tư duy tích sản hiện đại - Sở hữu đất vùng ven làm của để dành cho con cái.
GÓC NHÌN MỞ ĐẦU: Chia sẻ câu chuyện thực tế về xu hướng tích lũy tài sản dài hạn của nhiều gia đình trẻ hiện nay.
NỘI DUNG: Thay vì chi tiêu vào những tài sản tiêu sản hao hụt theo thời gian, nhiều người đã lựa chọn sở hữu những mảnh đất vuông vắn, pháp lý minh bạch tại vùng ven Hòa Bình. Đất đai không sinh thêm nhưng nhu cầu sống xanh và du lịch ven đô ngày càng lớn, tạo nên giá trị kế thừa vững bền cho thế hệ tương lai.`,
      keywords: "của để dành đất nền ven đô Hòa Bình",
    },
  ],

  ECO_LIFESTYLE: [
    {
      prompt: `CHỦ ĐỀ: Ngôi nhà thứ hai (second home) giữa thung lũng xanh mướt Hòa Bình.
GÓC NHÌN MỞ ĐẦU: Trải nghiệm buổi sớm thức dậy giữa không gian trong lành thoang thoảng mùi hương cỏ cây vùng cao.
NỘI DUNG: Chỉ hơn 1 giờ lái xe rời xa còi xe khói bụi Hà Nội, cả gia đình đã có chốn trở về an yên. Địa thế đồi bán sơn địa thoai thoải tựa sơn hướng thủy đón vượng khí, khí hậu bốn mùa mát lành. Nơi bố mẹ nghỉ ngơi tái tạo năng lượng, con trẻ thỏa sức khám phá thiên nhiên và ông bà an hưởng tuổi già thanh thản.`,
      keywords: "ngôi nhà thứ hai second home Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Có bao giờ bạn mơ về một mảnh vườn nhỏ lưng tựa đồi để trốn khỏi áp lực phố thị?
GÓC NHÌN MỞ ĐẦU: Đặt câu hỏi chạm đúng cảm xúc của những người đang sống và làm việc áp lực tại thủ đô.
NỘI DUNG: Phong cách sống chữa lành (wellness retreat) đang trở thành xu hướng tất yếu. Sở hữu một không gian sinh thái ven đô giúp bạn có rau sạch, quả ngọt và những buổi tiệc trà ngắm hoàng hôn buông trên thung lũng. Địa thế phong thủy đồi thoải mang lại tài lộc, bình an và sức khỏe dồi dào cho cả gia đình.`,
      keywords: "nhà vườn nghỉ dưỡng sinh thái Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Giá trị vô giá của sức khỏe và không gian sống xanh cho cả gia đình.
GÓC NHÌN MỞ ĐẦU: Góc nhìn nhân văn về định nghĩa của sự giàu có: giàu có về sức khỏe, thời gian bên người thân và không gian sống trong lành.
NỘI DUNG: Hòa Bình sở hữu cảnh quan thiên nhiên trác tuyệt với núi non trùng điệp, thung lũng xanh và nguồn nước mát lành. Một mảnh đất vườn sinh thái không chỉ là tài sản gia tăng giá trị mà còn là chiếc neo bình yên nuôi dưỡng tinh thần sau những ngày làm việc căng thẳng.`,
      keywords: "không gian sống xanh ven đô Hòa Bình",
    },
  ],

  LOCAL_CULTURE: [
    {
      prompt: `CHỦ ĐỀ: Say đắm nét đẹp bản sắc xứ Mường và ẩm thực Tây Bắc tại Hòa Bình.
GÓC NHÌN MỞ ĐẦU: Trải nghiệm một ngày hòa mình vào đời sống văn hóa bản địa mộc mạc và chân thành.
NỘI DUNG: Lắng nghe âm vang tiếng chiêng Mường ngân vang bên hiên nhà sàn truyền thống, thưởng thức ống cơm lam dẻo thơm cùng thịt lợn bản nướng lá móc mật đậm đà hương vị núi rừng. Nụ cười hồn hậu, lòng hiếu khách của bà con xứ Mường níu chân bất kỳ ai từng một lần ghé thăm.`,
      keywords: "ẩm thực cơm lam văn hóa xứ Mường Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Chiều sâu di sản bản địa - Linh hồn nâng tầm du lịch sinh thái Hòa Bình.
GÓC NHÌN MỞ ĐẦU: Góc nhìn sâu sắc về giá trị bền vững của bất động sản gắn liền với di sản văn hóa truyền thống.
NỘI DUNG: Hòa Bình là cái nôi của nền văn hóa Mường cổ kính với lễ hội Khai Hạ được công nhận là Di sản văn hóa phi vật thể quốc gia, sử thi Đẻ đất Đẻ nước và những áng mo Mường huyền thoại. Vùng đất có bề dày văn hóa ngàn năm luôn có sức sống trường tồn và sức hút du khách bốn phương mãnh liệt.`,
      keywords: "lễ hội Khai Hạ văn hóa cồng chiêng Mường Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Điều gì làm nên sức hút đặc biệt của vùng đất cửa ngõ Tây Bắc?
GÓC NHÌN MỞ ĐẦU: Đặt câu hỏi mở: "Phải chăng điều khiến người ta yêu mảnh đất Hòa Bình không chỉ là non nước hữu tình mà chính là con người nơi đây?"
NỘI DUNG: Giữa thung lũng bảng lảng khói chiều, những nếp nhà sàn thanh bình nép mình dưới bóng cây rợp mát. Con người sống chan hòa với thiên nhiên, gìn giữ trọn vẹn bản sắc cha ông. Khám phá Hòa Bình là hành trình tìm về những giá trị nguyên bản, tĩnh tại và đầy ắp yêu thương.`,
      keywords: "nhà sàn người Mường thung lũng Hòa Bình",
    },
  ],

  // Giữ lại tương thích ngược với các khung giờ cũ nếu có gọi thủ công
  MORNING: [
    {
      prompt: `CHỦ ĐỀ: Phong cách sống xanh và ngôi nhà thứ hai (second home) ven đô tại Hòa Bình.
NỘI DUNG: Buổi sáng trong lành, tiếng chim hót, trốn khói bụi Hà Nội chỉ hơn 1 giờ di chuyển. Không gian lý tưởng cho cả gia đình nghỉ ngơi cuối tuần, con trẻ trải nghiệm thiên nhiên, ông bà dưỡng già thanh thản.`,
      keywords: "đồi núi Lạc Sơn Hòa Bình sương sớm",
    },
  ],
  NOON: [
    {
      prompt: `CHỦ ĐỀ: Giới thiệu sản phẩm đất nền thực tế giá tốt, pháp lý chuẩn chỉnh tại Lạc Sơn Hòa Bình.
CĂN CỨ DỮ LIỆU TỪ KNOWLEDGE BASE:
${AREA_KNOWLEDGE_BASE}
NỘI DUNG: Nhấn mạnh diện tích đẹp 100-120m2, full thổ cư (ONT), sổ đỏ sẵn trao tay công chứng ngay trong ngày. Đường ô tô vào tận đất, điện nước đầy đủ.`,
      keywords: "đồi núi Lạc Sơn Hòa Bình",
    },
  ],
  EVENING: [
    {
      prompt: `CHỦ ĐỀ: Phân tích cơ hội đầu tư tích sản và đón sóng hạ tầng ven đô Hòa Bình.
NỘI DUNG: Đón đầu các tuyến đường cao tốc và liên tỉnh kết nối thủ đô với Tây Bắc. Kênh giữ tiền an toàn và chống lạm phát bền vững.`,
      keywords: "hồ Thung Nai sông Đà Hòa Bình",
    },
  ],
};

// Bài viết dự phòng chuẩn mực cho từng chủ đề (đảm bảo độ dài 130-180 từ, không markdown in đậm, luôn có hotline duy nhất)
const FALLBACK_CAPTIONS: Record<PostTopic, string> = {
  PLANNING_INFRASTRUCTURE: `🚗 HẠ TẦNG KẾT NỐI MỞ ĐƯỜNG – ĐÒN BẨY BỨT PHÁ CHO BẤT ĐỘNG SẢN HÒA BÌNH

Hạ tầng giao thông phía Tây thủ đô đang chứng kiến những bước chuyển mình mạnh mẽ với tiến độ mở rộng cao tốc Hòa Lạc - Hòa Bình lên 6 làn xe, tuyến cao tốc Hòa Bình - Mộc Châu và các cây cầu liên vùng đang ngày đêm tăng tốc thi công.

Thời gian di chuyển từ trung tâm Hà Nội về các huyện vùng ven Hòa Bình được rút ngắn xuống dưới 1 giờ. Giao thông thông suốt không chỉ thúc đẩy giao thương kinh tế và du lịch sinh thái mà còn tạo cú hích đòn bẩy khổng lồ cho giá trị bất động sản toàn vùng bứt phá.

Khi những cung đường huyết mạch mở ra, cơ hội luôn thuộc về những nhà đầu tư có tầm nhìn đi trước đón đầu.

Anh chị quan tâm hãy để lại bình luận hoặc nhắn tin trực tiếp cho trang để nhận trọn bộ tài liệu quy hoạch và vị trí tiềm năng nhé!

${POSTER_INFO_LINE}

#dathoabinh #quyhoachhoabinh #ha tanghoabinh #bdsgiare #secondhome`,

  BIG_INVESTORS: `🦅 ĐẠI BÀNG ĐỔ BỘ ĐÁNH THỨC TIỀM NĂNG BẤT ĐỘNG SẢN HÒA BÌNH

Làn sóng các tập đoàn địa ốc hàng đầu đang đổ bộ mạnh mẽ về Hòa Bình, tiêu biểu là siêu dự án quần thể nghỉ dưỡng khoáng nóng Đồi Thung (Lạc Sơn) của Sun Group với quy mô nghìn tỷ đồng cùng các đại đô thị sinh thái đang làm thay đổi toàn diện diện mạo địa phương.

Nguồn tài nguyên khoáng nóng vô giá kết hợp với địa thế bán sơn địa và bầu không khí mát lành quanh năm đang biến nơi đây thành thủ phủ nghỉ dưỡng chăm sóc sức khỏe hàng đầu miền Bắc.

Bài học thực tế từ các thị trường đi trước cho thấy, các quỹ đất vệ tinh sẵn sổ đỏ đón đầu ngay giai đoạn đầu của các siêu dự án luôn sở hữu tiềm năng tăng trưởng vượt bậc nhất.

Mời anh chị nhắn tin trực tiếp hoặc để lại bình luận để nhận sơ đồ quy hoạch chi tiết các vùng hưởng lợi trực tiếp ạ!

${POSTER_INFO_LINE}

#dathoabinh #sungroupdoithung #datnghiduong #bdsgiare #secondhome`,

  CASH_FLOW_ASSET: `📊 DỊCH CHUYỂN DÒNG TIỀN VÀ BÀI TOÁN TÍCH SẢN BỀN VỮNG VEN ĐÔ

Khi giá chung cư nội đô liên tục thiết lập mặt bằng giá mới, dòng tiền thông minh đang có xu hướng dịch chuyển mạnh mẽ về các vùng trũng giá ven đô có hạ tầng kết nối đồng bộ và pháp lý minh bạch.

So với việc gửi tiết kiệm chịu áp lực lạm phát, việc tích sản vào những mảnh đất nền sẵn sổ đỏ, full thổ cư tại Hòa Bình là phương án bảo toàn và gia tăng tài sản an toàn tối ưu. Vốn đầu tư ban đầu hợp lý, quyền sở hữu lâu dài và tiềm năng tăng trưởng vượt trội theo đà phát triển của địa phương.

Một tài sản đất đai có pháp lý chuẩn chỉ luôn là chỗ dựa tài chính vững chắc và của để dành giá trị cho con cháu sau này.

Anh chị quan tâm hãy nhắn tin cho trang để nhận danh sách các lô đất sổ đỏ vị trí đẹp nhất nhé!

${POSTER_INFO_LINE}

#dathoabinh #tichsanantoan #datnensodo #bdsgiare #secondhome`,

  ECO_LIFESTYLE: `🌿 NGÔI NHÀ THỨ HAI GIỮA THUNG LŨNG XANH – CHỐN VỀ AN YÊN CUỐI TUẦN

Chỉ hơn một giờ lái xe rời xa khói bụi và tiếng còi xe ngột ngạt của phố thị, bạn đã có thể thức dậy giữa thung lũng bảng lảng mây sương và hít căng lồng ngực bầu không khí trong lành của núi rừng Hòa Bình.

Địa thế đồi bán sơn địa thoai thoải tựa sơn hướng thủy đón trọn vượng khí, cảnh sắc thiên nhiên bốn mùa xanh mát. Đây chính là không gian lý tưởng để cả gia đình quây quần mỗi dịp cuối tuần: con trẻ được hòa mình cùng thiên nhiên cỏ cây, cha mẹ tìm lại sự cân bằng sau chuỗi ngày làm việc căng thẳng và ông bà an hưởng tuổi già thanh thản.

Sở hữu ngôi nhà thứ hai (second home) ven đô không chỉ là đầu tư cho một tài sản mà chính là đầu tư cho sức khỏe và hạnh phúc vô giá của cả gia đình.

Để lại bình luận hoặc nhắn tin ngay để nhận hình ảnh thực tế và vị trí không gian sống xanh tuyệt đẹp này nhé!

${POSTER_INFO_LINE}

#secondhome #datnghiduong #dathoabinh #songxanh #nhavuonven do`,

  LOCAL_CULTURE: `🎋 SAY ĐẮM NÉT ĐẸP BẢN SẮC XỨ MƯỜNG VÀ KHÔNG GIAN VĂN HÓA HÒA BÌNH

Giữa thung lũng thanh bình nép mình bên sườn đồi, những nếp nhà sàn truyền thống của đồng bào Mường hiện lên mộc mạc mà ấm áp. Hòa Bình níu chân du khách không chỉ bởi non nước hữu tình mà còn bởi chiều sâu di sản văn hóa ngàn năm.

Đó là âm vang trầm hùng của dàn chiêng Mường, nét rộn ràng của lễ hội Khai Hạ truyền thống và hương vị đậm đà khó quên của cơm lam, thịt nướng thơm lừng bên bếp lửa hồng. Sự hồn hậu, chân thành và lòng mến khách của con người nơi đây luôn tạo nên một cảm giác gần gũi, thân thương.

Một vùng đất giàu bản sắc văn hóa bản địa luôn sở hữu sức hút du lịch sinh thái bền bỉ và giá trị trường tồn theo năm tháng.

Anh chị yêu mến mảnh đất và văn hóa Hòa Bình hãy nhắn tin để cùng giao lưu và nhận thêm thông tin chia sẻ nhé!

${POSTER_INFO_LINE}

#vanhoaxumuong #dathoabinh #dulichhoabinh #lehoikhaiha #secondhome`,

  MORNING: `🌿 THỨC DẬY GIỮA MÂY NGÀN – NGÔI NHÀ THỨ HAI VEN ĐÔ TẠI HÒA BÌNH

Buổi sáng hít thở bầu không khí trong lành thoang thoảng mùi cỏ cây, xa rời hoàn toàn khói bụi ồn ào của thủ đô. Chỉ hơn 1 giờ lái xe, cả gia đình đã có chốn nghỉ dưỡng cuối tuần an yên, thảnh thơi làm vườn và hòa mình vào thiên nhiên.

Không gian xanh mát quanh năm, thế đất tựa đồi nhìn thung lũng
Diện tích 100-120m2, full thổ cư 100%, xây dựng tự do
Sổ đỏ chính chủ trao tay, công chứng sang tên ngay trong ngày
Đường ô tô vào tận đất, giao thông kết nối cực kỳ thuận tiện

Anh chị quan tâm để lại bình luận hoặc nhắn tin trực tiếp cho trang để nhận trọn bộ hình ảnh thực tế và vị trí lô đất nhé!

${POSTER_INFO_LINE}

#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare`,

  NOON: `🏡 SỞ HỮU ĐẤT NỀN SẴN SỔ ĐỎ GIÁ TRÚNG ĐẦU TƯ TẠI HÒA BÌNH

Cơ hội sở hữu lô đất nền nghỉ dưỡng tại Lạc Sơn với mức giá vùng trũng cực kỳ hấp dẫn, pháp lý rõ ràng minh bạch từng mét vuông!

Diện tích chuẩn đẹp: 100-120m2, 100% thổ cư (ONT)
Sổ đỏ riêng từng lô cầm tay, công chứng sang tên ngay
Đường bê tông ô tô vào tận nơi, điện nước sinh hoạt sẵn có
Bao trọn gói chi phí đo đạc sang tên sổ đỏ
Cuối tuần bên em có xe ô tô đưa đón tham quan thực tế miễn phí

Để lại bình luận hoặc nhắn tin ngay hôm nay để nhận thông tin trích lục sổ đỏ và chọn vị trí đẹp nhất ạ!

${POSTER_INFO_LINE}

#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare`,

  EVENING: `📈 TÍCH SẢN AN TOÀN ĐÓN SÓNG HẠ TẦNG VEN ĐÔ HÒA BÌNH

Khi bất động sản nội đô liên tục lập đỉnh, dòng tiền thông minh đang dịch chuyển mạnh mẽ về các vùng đất trũng ven đô có hạ tầng cao tốc kết nối đồng bộ.

Dư địa tăng trưởng còn rất lớn nhờ đón đầu cao tốc và đại dự án
Đất full thổ cư, sổ đỏ trao tay, bảo toàn vốn và chống lạm phát tối ưu
Thích hợp cả đầu tư tích lũy lâu dài lẫn làm homestay nhà vườn sinh thái
Giao thông liên tỉnh thuận tiện, kết nối nhanh chóng về trung tâm Hà Nội

Anh chị muốn đón đầu cơ hội hãy nhắn tin hoặc để lại bình luận bên dưới, em gửi ngay bảng giá và sơ đồ từng lô nhé!

${POSTER_INFO_LINE}

#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare`,
};

/**
 * Xử lý làm sạch nội dung do AI tạo ra và chuẩn hóa Hotline duy nhất:
 * - Loại bỏ suy nghĩ <think>...</think> nếu có.
 * - Xóa ký tự # làm tiêu đề Markdown ở đầu dòng.
 * - Loại bỏ ký hiệu in đậm (**) và ngoặc kép bao ngoài.
 * - Bỏ dòng "Người đăng:" cũ nếu có.
 * - HẬU KIỂM BẮT BUỘC: Đảm bảo 100% bài viết chỉ có duy nhất 1 dòng Hotline/Zalo chuẩn trước hashtag.
 *   Nếu trong thân bài chưa có -> nối thêm đúng 1 dòng.
 *   Nếu AI lỡ chèn 1 hoặc 2 dòng hotline -> chuẩn hóa và lọc sạch chỉ giữ lại 1 dòng duy nhất.
 */
export function cleanCaption(rawContent: string): string {
  let text = rawContent;

  // 1. Xóa khối suy nghĩ nội tâm <think>...</think> nếu có
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Xóa tiêu đề Markdown (# Tiêu đề, ## Tiêu đề) ở đầu dòng
  text = text.replace(/^#+\s+/gm, "");

  // 3. Xóa ký hiệu in đậm markdown (**)
  text = text.replace(/\*\*/g, "");

  // 4. Xóa dấu ngoặc kép bọc ngoài bài viết nếu AI vô tình thêm vào
  text = text.replace(/^["“](.*)["”]$/s, "$1").trim();

  // 5. Tách phần thân bài và khối hashtag ở cuối
  let before = text;
  let hashtags = "#dathoabinh #datnghiduong #bdsgiare #secondhome #quyhoachhoabinh";

  const firstHashtagIdx = text.search(/#[a-zA-Z0-9_À-ɏẠ-ỹ]+/);
  if (firstHashtagIdx !== -1) {
    before = text.slice(0, firstHashtagIdx).trimEnd();
    hashtags = text.slice(firstHashtagIdx).trim();
  }

  // 6. Xóa dòng 'Người đăng:' cũ nếu có
  before = before.replace(/^[^\n]*Người đăng:[^\n]*$/gmi, "").trimEnd();

  // 7. Chuẩn hóa chống lặp Hotline triệt để: Đảm bảo duy nhất 1 dòng hotline trước hashtag
  const hasHotlineNumber = /0916[\s.-]?060[\s.-]?254/.test(before);

  if (!hasHotlineNumber) {
    // Chưa có hotline: nối thêm đúng 1 dòng duy nhất
    before = `${before}\n\n${HOTLINE_LINE}`;
  } else {
    // Đã có số hotline trong thân bài (do AI sinh ra hoặc lặp dòng):
    // Quét từng dòng, thay thế dòng đầu tiên bằng HOTLINE_LINE chuẩn và xóa sạch mọi dòng lặp lại
    const lines = before.split("\n");
    let hotlineReplaced = false;
    const filteredLines: string[] = [];

    for (const line of lines) {
      const isHotlineLine =
        /0916[\s.-]?060[\s.-]?254/.test(line) ||
        /(?:📞|☎️|📲)?\s*Hotline\s*\/?\s*Zalo/i.test(line);

      if (isHotlineLine) {
        if (!hotlineReplaced) {
          filteredLines.push(HOTLINE_LINE);
          hotlineReplaced = true;
        }
        // Bỏ qua tất cả các dòng hotline xuất hiện lần thứ 2 trở đi
      } else {
        filteredLines.push(line);
      }
    }
    before = filteredLines.join("\n").trimEnd();
  }

  text = `${before}\n\n${hashtags}`;
  return text.trim();
}

/**
 * 1. Gọi AI Router viết nội dung theo 5 chủ đề xoay vòng chuyên sâu
 * Quy định rõ ràng: Bỏ yêu cầu chèn số hotline trong prompt của AI để AI tập trung viết bài và CTA.
 */
export async function generatePostContent(topic: PostTopic): Promise<GeneratedPost> {
  const angles = TOPIC_ANGLES[topic] || TOPIC_ANGLES.PLANNING_INFRASTRUCTURE;
  const selectedAngle = angles[Math.floor(Math.random() * angles.length)];

  const systemInstruction = `
Bạn là chuyên gia truyền thông và phát triển nội dung bất động sản Hòa Bình chuyên nghiệp.
Nhiệm vụ của bạn là viết một bài đăng Facebook Fanpage chất lượng cao, sâu sắc, cuốn hút và giàu cảm xúc theo góc nhìn chủ đề được cung cấp.

QUY CHUẨN BẮT BUỘC:
1. ĐỘ DÀI: Chuẩn từ 130 đến 180 từ. Ngắt dòng thoáng mắt, câu văn ngắn gọn, chia 2-3 đoạn ngắn mạch lạc, dễ đọc lướt trên điện thoại di động.
2. MỞ ĐẦU ĐỔI MỚI VÀ ĐA DẠNG:
   - Tuyệt đối không dùng một kiểu mở bài rập khuôn.
   - Bám sát yêu cầu góc nhìn mở đầu trong prompt: khi thì đặt câu hỏi khơi gợi suy ngẫm, khi thì đưa ra góc nhìn thị trường sắc bén, khi thì chia sẻ trải nghiệm thực tế gần gũi.
3. NỘI DUNG SÂU SẮC, ĐA DẠNG THẾ MẠNH:
   - Bám sát đúng chủ đề được phân công (Hạ tầng quy hoạch, Đại bàng BĐS, Dòng tiền tích sản, Phong cách sống sinh thái, Văn hóa bản sắc Mường).
   - TUYỆT ĐỐI KHÔNG chăm chăm lặp đi lặp lại cụm từ "đất 100 triệu" hay "đất giá rẻ" gây nhàm chán và giảm uy tín của Trang.
4. LỜI KÊU GỌI HÀNH ĐỘNG (CTA):
   - Kết thúc bài viết bằng lời kêu gọi hành động (CTA) tự nhiên, lịch thiệp (ví dụ: "Anh chị quan tâm để lại bình luận hoặc nhắn tin trực tiếp cho trang để nhận trọn bộ tài liệu quy hoạch và sơ đồ vị trí nhé!").
5. QUY ĐỊNH VỀ SỐ ĐIỆN THOẠI VÀ HOTLINE:
   - BỎ HOÀN TOÀN việc viết số điện thoại hay hotline trong bài viết của bạn. Tuyệt đối KHÔNG tự viết hotline hay số 0916.060.254. Hãy để lớp hệ thống bên ngoài tự động gắn thông tin liên hệ chuẩn.
6. HÌNH THỨC TRÌNH BÀY:
   - Sử dụng các biểu tượng cảm xúc (emoji) sinh động, tinh tế, đặt đúng chỗ để tăng tính trực quan.
   - TUYỆT ĐỐI KHÔNG dùng ký hiệu in đậm markdown (**).
   - TUYỆT ĐỐI KHÔNG dùng dấu thăng tiêu đề (# Tiêu đề).
7. HASHTAG CUỐI BÀI: Kết thúc bài viết bằng các hashtag: #dathoabinh #datnghiduong #bdsgiare #secondhome #quyhoachhoabinh
`.trim();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const res = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: selectedAngle.prompt },
        ],
        temperature: 0.75,
        max_tokens: 450,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`AI Router returned status ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data.choices?.[0]?.message?.content || "";

    if (!rawContent.trim()) {
      throw new Error("AI returned empty content");
    }

    const caption = cleanCaption(rawContent);

    return {
      caption,
      imageQuery: selectedAngle.keywords,
    };
  } catch (err) {
    console.error("[autoPost] AI generation failed, using thematic fallback:", err);
    return {
      caption: FALLBACK_CAPTIONS[topic] || FALLBACK_CAPTIONS.PLANNING_INFRASTRUCTURE,
      imageQuery: selectedAngle.keywords,
    };
  }
}

/**
 * 2. Tìm ảnh minh họa chất lượng cao từ kho ảnh Hòa Bình thực tế đã chọn lọc
 */
export async function searchContextImageUrl(
  query: string,
  topic?: PostTopic,
  captionText?: string
): Promise<string> {
  const fullContext = `${query || ""} ${captionText || ""}`.trim();
  const category = classifyImageCategory(fullContext, topic);

  const pool = HOA_BINH_IMAGE_GROUPS[category] || HOA_BINH_IMAGE_GROUPS.SCENERY;
  const randomUrl = pool[Math.floor(Math.random() * pool.length)];

  const cacheBuster = Math.floor(Math.random() * 1000000);
  return randomUrl.includes("?") ? `${randomUrl}&sig=${cacheBuster}` : `${randomUrl}?sig=${cacheBuster}`;
}

/**
 * 3. Đăng bài viết kèm ảnh lên Fanpage qua Meta Graph API chính thức
 */
export async function publishPostToPage(caption: string, imageUrl: string): Promise<PublishResult> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    return { success: false, error: "FB_PAGE_ACCESS_TOKEN not configured" };
  }

  try {
    const pageId = process.env.FB_PAGE_ID || "me";
    const url = `${GRAPH_BASE_URL}/${pageId}/photos`;
    const params = new URLSearchParams({
      url: imageUrl,
      caption: caption,
      published: "true",
      access_token: pageAccessToken,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { id?: string; post_id?: string; error?: { message?: string } };
    if (!res.ok || data.error) {
      const errMsg = data.error?.message || "Facebook API error";
      if (errMsg.includes("pages_manage_posts")) {
        console.warn("[autoPost] LƯU Ý KỸ THUẬT: Token hiện tại thiếu quyền pages_manage_posts. Cần bổ sung quyền này tại Meta Developers Console để đăng trực tiếp lên Fanpage.");
      }
      console.error("[autoPost] Facebook publish photo error:", data.error);
      return { success: false, error: errMsg };
    }

    const publishedId = data.post_id || data.id;
    console.log("[autoPost] Successfully published post to Facebook:", publishedId);
    return { success: true, id: publishedId };
  } catch (err) {
    console.error("[autoPost] Failed to publish post:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * 4. Hàm điều phối thực hiện một lượt đăng bài hoàn chỉnh:
 * - Nếu không truyền topic, tự động lấy chủ đề xoay vòng của ngày (getRotatingDailyTopic).
 * - Sử dụng khóa Firestore slotKey `${vnDateStr}_DAILY` để bảo đảm chống đăng trùng khi Cloud Run scale đa instance.
 */
export async function executeAutoPost(topic?: PostTopic): Promise<AutoPostResult> {
  const now = new Date();
  const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
  const vnDateStr = vnTime.toISOString().slice(0, 10);

  // Lấy chủ đề xoay vòng cho ngày nếu không chỉ định cụ thể
  const targetTopic: PostTopic = topic || getRotatingDailyTopic(now);

  // Khóa slot trong Firestore để chống đăng trùng lặp giữa các instance container
  const slotKey = topic ? `${vnDateStr}_${topic}` : `${vnDateStr}_DAILY`;
  const db = getDb();
  const postDocRef = db.collection("auto_posts").doc(slotKey);

  if (process.env.NODE_ENV !== "test") {
    try {
      const existing = await postDocRef.get();
      if (existing.exists) {
        console.log(`[autoPost] Slot ${slotKey} đã được đăng trước đó bởi instance khác trong ngày, bỏ qua.`);
        const data = existing.data();
        return {
          success: true,
          postId: data?.postId,
          topic: targetTopic,
          caption: data?.caption,
          imageUrl: data?.imageUrl,
        };
      }
    } catch {
      // Bỏ qua lỗi truy vấn Firestore nếu có
    }
  }

  console.log(`[autoPost] Starting auto-post workflow for topic: ${targetTopic} (slot: ${slotKey})`);
  const post = await generatePostContent(targetTopic);
  const imageUrl = await searchContextImageUrl(post.imageQuery, targetTopic, post.caption);
  const result = await publishPostToPage(post.caption, imageUrl);

  if (result.success && result.id && process.env.NODE_ENV !== "test") {
    try {
      await postDocRef.set({
        slot: slotKey,
        topic: targetTopic,
        postId: result.id,
        caption: post.caption,
        imageUrl,
        createdAt: Date.now(),
      });
    } catch {
      // Bỏ qua lỗi ghi Firestore
    }
  }

  return {
    success: result.success,
    postId: result.id,
    topic: targetTopic,
    caption: post.caption,
    imageUrl: imageUrl,
    error: result.error,
  };
}

/**
 * 5. Thiết lập lịch đăng tự động ĐÚNG 1 BÀI MỖI NGÀY lúc 08h30 sáng giờ Việt Nam (UTC+7)
 */
export function startAutoPostScheduler(): void {
  const CHECK_INTERVAL_MS = 60 * 1000; // Quét mỗi phút 1 lần
  let lastPostedDate = "";

  setInterval(async () => {
    const now = new Date();
    // Chuyển sang giờ và ngày theo múi giờ Việt Nam (UTC+7)
    const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
    const vnHours = vnTime.getUTCHours();
    const vnMinutes = vnTime.getUTCMinutes();
    const vnDateStr = vnTime.toISOString().slice(0, 10);

    // Khung giờ vàng duy nhất: 08h30 sáng theo giờ Việt Nam (1 bài / ngày)
    if (vnHours === 8 && vnMinutes === 30 && lastPostedDate !== vnDateStr) {
      lastPostedDate = vnDateStr;
      console.log(`[autoPost] Kích hoạt lịch đăng bài tự động 08h30 sáng VN cho ngày ${vnDateStr}...`);
      await executeAutoPost().catch((e) => console.error("[autoPost] Lỗi lịch đăng tự động 08h30:", e));
    }
  }, CHECK_INTERVAL_MS);

  console.log("[autoPost] Đã khởi tạo lịch đăng tự động: ĐÚNG 1 BÀI MỖI NGÀY lúc 08h30 sáng giờ Việt Nam.");
}
