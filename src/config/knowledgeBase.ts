/**
 * Dữ liệu khu đất — "căn cứ" duy nhất mà lớp diễn đạt tự nhiên bằng AI (mục 4.2 CLAUDE.md) được phép
 * dùng để trả lời khách. Sửa/mở rộng nội dung trực tiếp trong file này, không qua Google Sheet.
 *
 * Nguồn dữ liệu: tổng hợp từ (1) thông tin nghiệp vụ chủ dự án xác nhận trực tiếp (giá/m², diện
 * tích phổ biến, chính sách cọc/thanh toán, dịch vụ trông nom đất) — đã chốt trong buổi trao đổi cập
 * nhật knowledge base; (2) thông tin vùng miền tra cứu công khai, có thể kiểm chứng lại (dự án Sun
 * Group Đồi Thung, tiến độ cao tốc Hòa Bình – Mộc Châu, mốc sáp nhập tỉnh 2025) — nên coi các mốc
 * tiến độ/vốn đầu tư là tương đối, cần cập nhật định kỳ vì có thể thay đổi theo thời gian.
 *
 * LƯU Ý QUAN TRỌNG khi sửa file này: giá, mặt tiền, hiện trạng cây trồng... khác nhau theo TỪNG LÔ
 * cụ thể — nội dung dưới đây chỉ nêu KHOẢNG dao động/đặc điểm phổ biến, không phải số liệu cố định
 * của 1 lô duy nhất. Đã yêu cầu AI (qua system instruction trong geminiService.ts) trả lời dạng
 * khoảng và mời nhân viên tư vấn chốt chi tiết theo đúng lô khách quan tâm — không tự bịa 1 con số
 * tuyệt đối cho 1 lô cụ thể nào mà file này không nêu rõ.
 */
export const AREA_KNOWLEDGE_BASE = `
## Vị trí & tổng quan khu vực
- Đất thuộc địa bàn Huyện Lạc Sơn (cũ), Tỉnh Hòa Bình. Từ giữa năm 2025, tỉnh Hòa Bình đã sáp nhập cùng Vĩnh Phúc, Phú Thọ thành tỉnh Phú Thọ (mới); huyện Lạc Sơn cũ nay được tổ chức lại thành các xã mới thuộc tỉnh Phú Thọ. Khi trả lời khách, luôn ưu tiên gọi theo tên cũ quen thuộc ("Huyện Lạc Sơn, Tỉnh Hòa Bình") kèm chú thích ngắn "nay thuộc Tỉnh Phú Thọ" — không cần đi sâu vào ranh giới hành chính mới vì khá phức tạp và không phải trọng tâm khách quan tâm.
- Các lô đất đang bán nằm rải rác ở nhiều xã trong khu vực Lạc Sơn (cũ), gồm: Xuất Hóa, Quý Hòa, Tân Lập, Yên Nghiệp, Vũ Bình, Nhân Nghĩa. Mỗi xã có vị trí, thế đất, mặt tiền khác nhau. Nếu khách hỏi về 1 trong 6 xã này, trả lời đúng là bên em có đất tại đó; nếu khách hỏi 1 xã khác không có trong danh sách, trả lời trung thực là hiện khu vực đó bên em chưa có lô nào, gợi ý để nhân viên tư vấn cập nhật thêm — không suy đoán bừa.
- Đây là vùng bán sơn địa (đồi thấp xen ruộng), khí hậu mát mẻ quanh năm, cảnh quan đồi thoai thoải, thung lũng ruộng bậc thang, suối tự nhiên — cùng khu vực địa lý với Lương Sơn, Kim Bôi, Cao Phong, Kỳ Sơn (Hòa Bình cũ) nhưng mặt bằng giá đất hiện đang thấp hơn nhiều.

## Giá bán & diện tích
- Mỗi lô một giá khác nhau, phụ thuộc 3 yếu tố chính: (1) diện tích lô, (2) vị trí địa lý (xã/khu vực), (3) độ gần mặt đường lớn — lô càng gần đường lớn/trục chính thì giá/m² càng cao.
- Diện tích phổ biến nhất: 100-120m²/lô, hầu hết là đất thổ cư (ONT) toàn bộ diện tích (xem mục Pháp lý & quy hoạch). Cũng có các lô diện tích lớn hơn (300-400m²) — các lô diện tích lớn này thường có đơn giá/m² rẻ hơn mặt bằng chung.
- **Khi khách hỏi giá chung chung lần đầu** (chưa hỏi rõ mức cao nhất/đắt nhất): chỉ trả lời **giá rẻ nhất từ 1,5 triệu đồng/m²** và mức phổ biến **2-3 triệu đồng/m²** — đây là điểm mạnh "giá rẻ" cần nhấn mạnh trước để thu hút khách. **TUYỆT ĐỐI KHÔNG** chủ động nhắc tới mức giá cao nhất (15 triệu đồng/m²) trong câu trả lời này.
- **CHỈ khi khách hỏi cụ thể** về mức giá cao nhất/đắt nhất (vd "đắt nhất bao nhiêu", "giá cao nhất là bao nhiêu", "lô đẹp/mặt tiền to nhất giá sao") mới trả lời: cũng có lô lên tới khoảng 15 triệu đồng/m², thường là các lô mặt tiền đẹp, sát đường lớn — giải thích ngắn gọn lý do đắt hơn (vị trí, mặt tiền).
- Khi khách hỏi giá cụ thể mà chưa rõ khách quan tâm lô/xã/diện tích nào, trả lời theo đúng khoảng giá rẻ nhất/phổ biến ở trên (không kèm mức cao nhất trừ khi được hỏi như quy tắc trên), giải thích ngắn gọn giá phụ thuộc vị trí và diện tích, rồi mời nhân viên báo giá chính xác theo đúng lô khách quan tâm — tuyệt đối không tự bịa ra 1 con số cụ thể cho 1 lô cụ thể nào.

## Pháp lý & quy hoạch
- 100% các lô đất giới thiệu đều đã có sổ đỏ (Giấy chứng nhận QSDĐ) riêng, chính chủ, không phải đất chung sổ chờ tách thửa, không mua bán giấy tay, không phải đất dịch vụ/đất dự án trôi nổi.
- Hầu hết các lô đất bên em bán là đất FULL THỔ CƯ (100% đất ở nông thôn - ONT) — toàn bộ diện tích ghi trên sổ đỏ đều là đất ở, được xây dựng tự do, không phải đất vườn hay đất nông nghiệp xen lẫn. Chỉ một phần nhỏ còn lại có thể có kèm thêm ít diện tích đất trồng cây lâu năm/hàng năm (CLN/HNK) tùy lô — cần xác nhận đúng theo từng lô cụ thể khi khách hỏi, không mặc định lô nào cũng full thổ cư 100%.
- Vì phần lớn là đất thổ cư (ONT) nên có thời hạn sử dụng lâu dài, không phải xin gia hạn định kỳ. Chỉ với phần nhỏ số lô có kèm đất CLN/HNK, riêng phần diện tích đó mới có thời hạn 50 năm theo Luật Đất đai; hết hạn chỉ cần làm thủ tục xin gia hạn tại xã/huyện, thủ tục đơn giản, chi phí thấp, không ảnh hưởng quyền sử dụng lâu dài trên thực tế.
- Trước khi nhận bán, đất đã được kiểm tra không dính quy hoạch đường giao thông, dự án, hay rừng phòng hộ. Sẵn sàng cùng khách lên Bộ phận Một cửa hoặc Phòng Tài nguyên & Môi trường huyện Lạc Sơn (trụ sở cũ tại thị trấn Vụ Bản) để kiểm tra trích lục quy hoạch nếu khách có nhu cầu xác minh trực tiếp.
- Đất không thế chấp ngân hàng tại thời điểm bán, ranh giới đã xác định rõ với các hộ liền kề (có mốc/hàng rào), không trong tình trạng tranh chấp.
- Đất ở nông thôn (ONT) được miễn giấy phép xây dựng với nhà ở riêng lẻ dưới 7 tầng theo quy định hiện hành — chỉ cần báo qua cán bộ địa chính/xây dựng xã là có thể xây nhà vườn, nhà sàn, làm hàng rào.

## Hạ tầng giao thông & khoảng cách
- Đường vào các lô đất phổ biến rộng khoảng 4-6m, đã bê tông hóa (đường nông thôn mới), ô tô 7 chỗ/sedan gầm thấp/bán tải vào tận nơi được, có điểm tránh xe ở các đoạn cua.
- Khu vực cách Quốc lộ 12B khoảng 1,5-2km, kết nối thuận tiện ra đường Hồ Chí Minh.
- Từ trung tâm Hà Nội, lái xe về khu vực Lạc Sơn khoảng 90-110km, tương đương 1,5-2 giờ chạy xe tùy lộ trình — phổ biến nhất là Đại lộ Thăng Long → cao tốc Hòa Lạc – Hòa Bình → Quốc lộ 6/12B, hoặc theo hướng đường Hồ Chí Minh.
- Trong bán kính 3-5km quanh khu vực thường có chợ dân sinh, trường tiểu học, trạm y tế xã. Trung tâm thị trấn Vụ Bản (cũ) — nơi có siêu thị, ngân hàng (Agribank, BIDV...), bệnh viện đa khoa huyện — cách khoảng 7-10 phút chạy xe tùy xã.

## Hạ tầng kỹ thuật & sinh hoạt
- Điện lưới quốc gia đã kéo tới khu vực (cột hạ thế dọc các tuyến đường chính); khách chỉ cần đăng ký với điện lực huyện/xã để lắp công tơ riêng, chi phí lắp đặt tham khảo khoảng 2-3 triệu đồng.
- Nguồn nước sinh hoạt: có thể dùng nước mó tự nhiên từ núi hoặc khoan giếng (độ sâu tham khảo 25-40m tới mạch nước ngầm), qua lọc cát thô thông thường là dùng được cho sinh hoạt.
- Sóng điện thoại di động (Viettel, VinaPhone) và Internet cáp quang (Viettel/VNPT) đã phủ tới khu vực, đủ dùng để làm việc từ xa vào cuối tuần.

## Đặc điểm thế đất & cảnh quan
- Các lô đất chủ yếu ở thế đồi thoai thoải (dốc nhẹ khoảng 5-10 độ), lưng tựa đồi, mặt hướng thoáng — dễ san gạt làm nhà vườn mà không tốn nhiều chi phí kè móng. Cũng có một số lô đất bằng phẳng.
- View phổ biến trong khu vực: nhìn ra thung lũng ruộng bậc thang, đồi núi, hoặc suối tự nhiên tùy vị trí từng lô — cần hỏi rõ view của đúng lô khách quan tâm, không mặc định lô nào cũng giống nhau.
- Trên một số lô có sẵn cây lâu năm (bưởi, cam, keo...) — hiện trạng cụ thể khác nhau theo từng lô, cần xác nhận lại trước khi trả lời chắc chắn với khách.
- Khu vực đồi đất nhìn chung có kết cấu ổn định, nền cao ráo, thoát nước theo triền đồi tốt, thực tế ít ghi nhận sạt lở/ngập úng. Không cam kết tuyệt đối 100% với mọi lô trong mọi tình huống thời tiết cực đoan — nếu khách hỏi kỹ về rủi ro thiên tai, nên trả lời trung thực theo hướng trên và mời khách cùng đi khảo sát thực tế lô cụ thể.
- Môi trường xung quanh khu vực chủ yếu là đất nông nghiệp, đồi rừng của người dân địa phương. Việc có gần trại chăn nuôi/nghĩa trang hay không khác nhau theo từng lô — cần xác nhận theo đúng lô cụ thể, không mặc định là hoàn toàn không có.

## Dân cư & an ninh
- Cư dân bản địa chủ yếu là người Mường, thân thiện, mến khách. Khu vực đã có một số khách ở Hà Nội và các tỉnh mua đất để làm nhà vườn, nghỉ dưỡng cuối tuần hoặc thử nghiệm mô hình homestay/farmstay.
- An ninh trật tự nhìn chung tốt, đặc trưng của vùng nông thôn miền núi.
- Khách mua đất qua bên em được hỗ trợ MIỄN PHÍ dịch vụ trông nom đất tại địa phương (trông coi, hỗ trợ cơ bản khi đất chưa xây dựng hoặc chủ ở xa chưa lên thường xuyên).

## Tiềm năng đầu tư & hạ tầng lớn quanh khu vực (mốc tiến độ mang tính tham khảo, cần cập nhật định kỳ)
- Khu vực Đồi Thung (xã Quý Hòa, Lạc Sơn) và Cuối Hạ (Kim Bôi) đang được Sun Group triển khai tổ hợp nghỉ dưỡng khoáng nóng quy mô lớn (vốn đầu tư công bố hơn 21.000 tỷ đồng), có cáp treo, phong cách nghỉ dưỡng kiểu châu Âu — đây là một trong các động lực lớn cho thị trường đất khu vực Lạc Sơn, đặc biệt các lô ở xã Quý Hòa.
- Tuyến cao tốc Hòa Bình – Mộc Châu đang được thi công (mục tiêu hoàn thành khoảng năm 2027), cùng các tuyến liên kết vùng Hòa Bình – Hà Nam – Ninh Bình, được kỳ vọng rút ngắn thời gian di chuyển và tăng kết nối du lịch cho khu vực trong vài năm tới.
- So với mặt bằng giá đất nghỉ dưỡng tại các khu vực lân cận như Lương Sơn, Kim Bôi, Cao Phong (hiện phổ biến 4-8 triệu đồng/m² trở lên), giá đất khu vực Lạc Sơn (phổ biến 2-3 triệu đồng/m²) vẫn đang ở vùng trũng giá, còn dư địa tăng khi hạ tầng và các dự án lớn hoàn thiện.

## Định hướng phát triển công nghiệp & các cụm/khu công nghiệp gần khu vực (mốc quy hoạch mang tính tham khảo, cần cập nhật định kỳ)
- Theo Quy hoạch tỉnh Hòa Bình 2021-2030 tầm nhìn 2050, không gian công nghiệp toàn tỉnh (cũ) được chia làm 3 vùng: (1) vùng ưu tiên công nghiệp sạch/công nghệ cao tại TP. Hòa Bình và Lương Sơn; (2) vùng KHÔNG GIAN TĂNG TRƯỞNG CÔNG NGHIỆP MỚI gồm các huyện Lạc Thủy, Yên Thủy, LẠC SƠN, Tân Lạc và phía Nam Lương Sơn; (3) vùng công nghiệp mang tính địa phương tại Cao Phong, Kim Bôi, Mai Châu, Đà Bắc. Lạc Sơn được xếp vào nhóm vùng tăng trưởng công nghiệp MỚI của tỉnh — không phải vùng thuần nông/chỉ có du lịch, cho thấy kinh tế địa phương đang được quy hoạch đa dạng hoá, kéo theo nhu cầu lao động, nhà ở và đầu tư hạ tầng.
- Cụm công nghiệp Đầm Đuống (huyện Lạc Sơn) là 1 trong các cụm công nghiệp hiện có của tỉnh đang được đề xuất mở rộng quy mô. Cụm công nghiệp Khoang Rào (huyện Lạc Sơn) đang được đề xuất bổ sung là cụm công nghiệp mới trong quy hoạch cập nhật gần đây của tỉnh.
- Toàn tỉnh Hòa Bình (cũ) được quy hoạch tổng cộng khoảng 38 cụm công nghiệp và 16 khu công nghiệp (tổng diện tích quy hoạch khoảng 3.494ha) trong giai đoạn 2021-2030, tầm nhìn 2050 — cho thấy định hướng phát triển công nghiệp của tỉnh lan tỏa tới cả các huyện miền núi như Lạc Sơn, không chỉ tập trung ở khu vực trung tâm.
- Huyện Lạc Sơn (cũ) đã có nghị quyết chuyên đề riêng về phát triển đô thị, đặt mục tiêu tỷ lệ đô thị hóa đạt 15% vào năm 2025 và 25% vào năm 2030, cùng chính sách ưu đãi thu hút doanh nghiệp đầu tư và hỗ trợ phát triển nông nghiệp công nghệ cao trên địa bàn.
- **Lưu ý khi trả lời khách**: các cụm/khu công nghiệp trên phục vụ mục đích sản xuất, chỉ nên dùng làm minh chứng huyện Lạc Sơn đang được quy hoạch phát triển đa dạng (công nghiệp + du lịch + nông nghiệp) — KHÔNG khẳng định hay suy diễn rằng các lô đất đang bán nằm liền kề/ngay cạnh bất kỳ cụm/khu công nghiệp nào nếu không được xác nhận cụ thể theo từng lô, vì điều này có thể mâu thuẫn với chính điểm mạnh "yên tĩnh, trong lành, nghỉ dưỡng" đang quảng bá.

## Chính sách của Đảng & Nhà nước làm nền tảng lâu dài cho khu vực (dùng để giải thích CĂN CỨ khách quan cho tiềm năng khu vực, không phải lời quảng cáo suông — mốc văn bản mang tính tham khảo, cần cập nhật định kỳ)
- Nghị quyết số 08-NQ/TW (16/1/2017) của Bộ Chính trị xác định phát triển du lịch trở thành ngành kinh tế mũi nhọn của cả nước; Bộ Chính trị khoá XIV mới đây tiếp tục ban hành Nghị quyết số 26-NQ/TW (22/8/2026) kế thừa và nâng tầm định hướng này cho giai đoạn mới — đây là chủ trương xuyên suốt gần 10 năm qua, không phải phong trào ngắn hạn, tạo nền tảng chính sách lâu dài cho các vùng có tiềm năng du lịch sinh thái/nghỉ dưỡng như Lạc Sơn.
- Quy hoạch tỉnh Hòa Bình thời kỳ 2021-2030, tầm nhìn đến 2050 (Thủ tướng phê duyệt 20/12/2023) xác định rõ định hướng phát triển: "công nghiệp là động lực, DU LỊCH LÀ MŨI NHỌN, nông nghiệp sạch/hữu cơ làm nền tảng", gắn với hạ tầng hiện đại và đô thị xanh, thông minh — khu vực Lạc Sơn (cũ) nằm trong định hướng phát triển du lịch sinh thái, nghỉ dưỡng núi của quy hoạch này.
- Sau khi tỉnh Hòa Bình sáp nhập cùng Phú Thọ, Vĩnh Phúc thành tỉnh Phú Thọ mới (trung tâm hành chính đặt tại TP. Việt Trì, quy mô hơn 4 triệu dân), tỉnh Phú Thọ (mới) đã ban hành Nghị quyết số 29-NQ/TU và Đề án phát triển du lịch giai đoạn 2026-2030, định hướng du lịch xanh, bền vững, thông minh, gắn đổi mới sáng tạo và chuyển đổi số — khu vực miền núi phía Tây tỉnh (Lạc Sơn, Kim Bôi, Cao Phong... thuộc Hòa Bình cũ) là một trong các không gian phát triển du lịch sinh thái, nghỉ dưỡng chủ lực của tỉnh mới.
- Vì hầu hết đất bên em bán là đất FULL THỔ CƯ (ONT — mục Pháp lý & quy hoạch ở trên), khách được xây dựng tự do trên toàn bộ diện tích mà không cần viện dẫn thêm quy định nào về đất nông nghiệp. Riêng với phần nhỏ số lô có kèm thêm đất CLN/HNK: Luật Đất đai 2024 (hiệu lực từ 1/8/2024), Điều 218 cho phép phần đất nông nghiệp đó được sử dụng KẾT HỢP với mục đích thương mại, dịch vụ (bao gồm du lịch sinh thái, nông trại trải nghiệm) mà KHÔNG cần chuyển đổi mục đích sử dụng đất, với điều kiện: diện tích sử dụng kết hợp không quá 50% tổng diện tích phần đất nông nghiệp đó, phải lập phương án sử dụng đất kết hợp được cơ quan có thẩm quyền phê duyệt, công trình dựng lên phải dễ tháo dỡ và không ảnh hưởng quy hoạch/môi trường. Chỉ nhắc tới điều luật này khi khách hỏi về đúng phần diện tích CLN/HNK của lô có loại đất này — không áp dụng cho phần đất thổ cư (ONT) vốn đã được xây dựng tự do sẵn.
- Chương trình mục tiêu quốc gia phát triển kinh tế - xã hội vùng đồng bào dân tộc thiểu số và miền núi giai đoạn 2021-2030 (phê duyệt theo Quyết định 1719/QĐ-TTg) dành nguồn lực đầu tư hạ tầng (đường giao thông, điện, nước sinh hoạt, y tế, giáo dục...) cho các huyện miền núi có đông đồng bào dân tộc thiểu số như Lạc Sơn (đông người Mường) — đây là một phần lý do hạ tầng đường bê tông nông thôn mới, điện, nước tại khu vực đang được đầu tư, nâng cấp nhanh trong những năm gần đây.
- Khi khách hỏi về "tiềm năng tăng giá" hay "vì sao nên đầu tư bây giờ", AI được phép nhắc tới các chính sách trên như CĂN CỨ khách quan, khách sẽ tin tưởng hơn thay vì chỉ nghe lời quảng cáo chung chung — nhưng TUYỆT ĐỐI không được diễn giải các chính sách này thành lời cam kết chắc chắn về giá đất sẽ tăng bao nhiêu % hay tăng vào thời điểm cụ thể nào, vì đây là chính sách vĩ mô của Nhà nước, không phải cam kết riêng cho bất kỳ lô đất cụ thể nào.

## Chính sách giao dịch & thanh toán
- Đặt cọc: 50 triệu đồng, lập văn bản/hợp đồng đặt cọc rõ ràng.
- Trong vòng 15 ngày kể từ ngày đặt cọc, hai bên ra Văn phòng Công chứng ký Hợp đồng chuyển nhượng và thanh toán phần lớn giá trị lô đất.
- Giữ lại 10 triệu đồng, thanh toán nốt khi khách nhận được sổ đỏ mới đứng tên mình.
- Giá bán đã bao gồm chi phí đo đạc, công chứng, sang tên và các loại thuế/phí chuyển nhượng liên quan theo quy định — khách không phát sinh thêm chi phí ẩn ngoài các mốc trên.
- Đất có sổ đỏ đầy đủ nên có thể hỗ trợ thủ tục vay thế chấp ngân hàng nếu khách có nhu cầu dùng đòn bẩy tài chính (tham khảo: ngân hàng thường định giá cho vay khoảng 50-70% giá trị đất có sổ đỏ hợp lệ).

## Ưu đãi tham quan thực tế
- Có xe đưa đón miễn phí cho khách muốn lên tận nơi xem đất thực tế vào cuối tuần (thứ Bảy/Chủ nhật).

## Khi khách hỏi xin số Zalo/số điện thoại liên hệ của bên em
- Nếu khách hỏi xin số Zalo hoặc số điện thoại để chủ động liên hệ trực tiếp với bên em (khác với việc bên em xin số của khách để tư vấn) — cung cấp đúng số: 0916.060.254.
`.trim();
