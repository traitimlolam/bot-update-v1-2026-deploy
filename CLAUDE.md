# CLAUDE.md — Chatbot Fanpage Bất Động Sản (Messenger + Comment Auto-Reply + Google Sheet)

> File này là đặc tả kỹ thuật (spec) để Claude Code triển khai dự án. Mọi mô tả nghiệp vụ mơ hồ trong bản gốc đã được viết lại thành quy tắc tường minh, có mã hoá (M1-M6, R1-R..., AC1-AC...) để tránh việc phải "đoán ý". Khi cần thay đổi hành vi, sửa trực tiếp trong file này trước, không sửa rải rác trong code.

---

## 0. Mục tiêu & phạm vi

Xây một bot vận hành Fanpage bất động sản, gồm 3 khối chức năng độc lập:

1. Tự động trả lời Messenger theo kịch bản cố định (nút bấm + tin nhắn tự do).
2. Tự động trả lời (Private Reply) khi khách comment trên bài đăng của Page.
3. Ghi nhận lead (số điện thoại + thông tin khách) vào Google Sheet theo đúng định dạng cột có sẵn, và phân bổ nhân viên phụ trách theo vòng lặp (round-robin) vào cột F.

**Không thuộc phạm vi bản này** (xem mục 14 — giới hạn kỹ thuật): báo tin cho nhân viên (Zalo hay kênh khác) khi có lead mới — đã lược bỏ khỏi bản này, làm ở đặc tả riêng sau; lấy địa chỉ/tỉnh thành khách tự động từ hồ sơ Facebook; và lấy/ghi link Facebook cá nhân của khách vào trang tính (dù tự động hay thủ công — đã bỏ hẳn khỏi dự án theo quyết định chủ dự án, xem mục 8).

---

## 1. Việc cần xác nhận trước khi code (đang để TODO — không tự suy diễn)

Claude Code **không được tự bịa giá trị** cho các mục sau. Nếu gặp phải khi code, dừng lại và hỏi người dùng, hoặc implement ở dạng cấu hình (config) dễ sửa sau:

- **Cột G** trong Google Sheet ("Tư vấn"): bot **không ghi gì vào cột này**, giữ nguyên trống, nhân viên tự điền tay như trước giờ.
- **Cột E** ("Nguồn khách", cập nhật quyết định — trước đây để trống, nay chủ dự án yêu cầu tự động hoá): bot **tự động chọn 1 trong các giá trị có sẵn của dropdown (data validation) cột E** tuỳ theo kênh phát sinh số điện thoại hợp lệ — số điện thoại đến từ tin nhắn Messenger trực tiếp → ghi `"Tin nhắn"`; số điện thoại đến ngay trong nội dung comment trên Page → ghi `"Cmt"`. Xem mục 8.
- **Danh sách nhân viên** cho round-robin (cột F) — đọc trực tiếp từ dropdown (data validation) của cột F trên Sheet tại thời điểm ghi lead, không dùng file cấu hình riêng, xem mục 9.
- **ID/Access token thật**: Facebook Page ID, App ID/Secret, Google Sheet ID — tất cả để dạng biến môi trường trống trong `.env.example`, không hard-code.
- **Định dạng số điện thoại chấp nhận**: mặc định chỉ chấp nhận số Việt Nam 10 chữ số bắt đầu bằng `0` (đầu số di động hợp lệ: 03, 05, 07, 08, 09). Nếu khách gõ có `+84`, khoảng trắng, dấu gạch ngang — chuẩn hoá trước khi kiểm tra độ dài.

---

## 2. Kiến trúc & tech stack

- **Ngôn ngữ/framework**: Node.js + TypeScript + Express (webhook server đơn giản, hệ sinh thái SDK Facebook tốt).
- **Lưu trạng thái hội thoại + counter round-robin**: Firestore (Native mode, free tier rộng, hỗ trợ transaction atomic — tránh lỗi đếm sai khi nhiều lead đến cùng lúc, đồng thời an toàn khi chạy nhiều instance).
- **Lưu lead**: Google Sheets API (service account).
- **Trả lời tự do bằng AI**: Gemini Developer API qua Google AI Studio (model `gemini-3.5-flash`, dùng free tier — xem mục 4.2 và mục 14 về lý do chọn model/lựa chọn nền tảng này để tối giản chi phí).
- **Hosting**: ưu tiên Google Cloud Run hoặc Cloudflare Workers (free tier đủ dùng cho quy mô 1 fanpage, cold-start thấp hơn nhiều so với Render/Railway free tier — quan trọng vì khách chờ phản hồi tức thời).

---

## 3. Cấu trúc thư mục (ranh giới module rõ ràng)

```
src/
  config/
    messages.json        # danh mục M1-M7, xem mục 4 — sửa nội dung tin nhắn ở ĐÂY, không sửa trong code
    knowledgeBase.ts        # dữ kiện BĐS duy nhất AI được phép dùng khi trả lời tự do — mục 4.2
  ai/
    geminiService.ts        # gọi Gemini Developer API (Google AI Studio) sinh câu trả lời tự do — mục 4.2
  webhook/
    facebook.ts            # nhận & xác thực webhook Facebook (messages, postbacks, feed/comment); comment cũng được quét số điện thoại trước khi quyết định chốt lead hay gửi M1-M3 — mục 5.3
  flow/
    flowEngine.ts          # state machine hội thoại — xem mục 5, 6
    phoneValidator.ts        # chuẩn hoá & validate số điện thoại — mục 7
  services/
    sheetsService.ts        # ghi Google Sheet + round-robin qua dropdown cột F + theo dõi "hỏi lại" — mục 8, 8b, 8c, 9
  state/
    firestore.ts        # kết nối Firestore dùng chung cho flow state (conversations, errors) + withLock (khoá chống lệnh chồng chéo, mục 10)
  util/
    retry.ts        # withRetry dùng chung giữa webhook/facebook.ts và services/sheetsService.ts
  index.ts               # khởi tạo Express app, mount route webhook, fail-fast nếu thiếu FB_APP_SECRET/FB_VERIFY_TOKEN
.env.example
test/
  fixtures/                # payload webhook mẫu (Facebook message, postback, comment, comment kèm SĐT) — mục 13
  flowEngine.test.ts
  phoneValidator.test.ts
  sheetsService.test.ts          # pickNextStaff + resolveTargetSheetName (hàm thuần, mục 8/8b/9)
  facebookSignature.test.ts        # verifySignature với fixture (mục 15 bước 3)
  leadSheetGuard.test.ts        # spy appendLead ở tầng orchestration — mục 13
  loadConfig.test.ts
  geminiService.test.ts        # buildSystemInstruction (hàm thuần, mục 4.2/13)
```

**Lưu ý quan trọng cho Claude Code**: `flowEngine.ts`, `phoneValidator.ts`, và các hàm thuần trong `sheetsService.ts` (`pickNextStaff`, `resolveTargetSheetName`) phải là hàm JavaScript/TypeScript thuần (nhận input, trả output, không tự gọi API bên ngoài) để có thể unit test bằng Jest trên Node như file thường. `webhook/facebook.ts`, phần còn lại của `services/sheetsService.ts`, `state/firestore.ts`, và phần gọi API thật trong `ai/geminiService.ts` là lớp mỏng gọi API bên ngoài, chỉ test thủ công (xem mục 13) — riêng hàm dựng system prompt (`buildSystemInstruction`) trong `geminiService.ts` vẫn phải là hàm thuần để unit test được.

Mỗi module chỉ giao tiếp qua hàm export tường minh — nếu triển khai song song nhiều phiên Claude Code, mỗi phiên nhận đúng 1 file và không sửa file ngoài phạm vi được giao.

---

## 4. Danh mục tin nhắn (Message Catalog) — `config/messages.json`

Toàn bộ nội dung trả lời khách được định nghĩa 1 lần ở đây, flow chỉ tham chiếu mã, **không hard-code chuỗi trong logic**.

| Mã | Nội dung |
|----|----------|
| M1 | Em chào anh/chị. |
| M2 | Hiện tại bên em đang có các quỹ đất giá rẻ từ 2tr/m2. Tổng giá chỉ từ 200tr/lô tại Huyện Lạc Sơn, Tỉnh Hòa Bình (cũ), nay là xã Lạc Sơn - Tỉnh Phú Thọ. |
| M3 | Anh/chị nhắn em số zalo nhé. Em gửi vị trí, ảnh mặt bằng và bảng giá chi tiết anh/chị tham khảo ạ. |
| M4 | Tất cả đất bên em bán đều có sổ đỏ, pháp lý rõ ràng, công chứng trong ngày. |
| M5 | Anh/Chị chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với anh chị ngay đây ạ. |
| M6 | Anh/chị kiểm tra lại số điện thoại giúp em, nó đang {thiếu/thừa} số ạ. (M6_INVALID — sai đầu số nhưng đúng 10 số — giữ nguyên câu cũ "chưa đúng định dạng", không thuộc dạng thiếu/thừa) |
| M7 | Dạ, em đã có số điện thoại của anh/chị và chuyển đến cho nhân viên phụ trách, anh/chị chờ một chút em báo nhân viên liên hệ lại ngay với anh chị đây ạ. |

Quy tắc gửi: mỗi mã là **một tin nhắn Messenger riêng biệt** (không gộp), cách nhau tối thiểu 2 giây, kèm hiệu ứng "đang nhập..." (sender action `typing_on`) trước mỗi tin để tự nhiên hơn.

### 4.1 Cá nhân hoá đại từ xưng hô theo giới tính khách hàng (`src/utils/genderDetector.ts`)

Trước khi gửi bất kỳ tin nhắn nào (M1, M3, M5, M6, M7) tới khách, bot tự động phân tích tên Facebook của khách hàng để thay thế danh xưng cho tự nhiên và chuyên nghiệp nhất:

1. **Phân tích giới tính (`analyzeVietnameseName`)**:
   - **Nữ (`FEMALE`)**: Tên đệm chứa chữ "Thị" (100% Nữ) hoặc tên chính thuộc từ điển tên nữ phổ biến (*Hương, Hằng, Lan, Mai, Trang, Thảo, Linh, Hoa, Nga, Tuyết, Loan, Yến, Nhung, Hạnh, Thủy, Ngân, Ly, Huyền, Trâm, Phương, Trinh, Quỳnh, Hiền, My, Chi, Vân, Thư, Đào, Khiêm...*).
   - **Nam (`MALE`)**: Tên đệm nam đặc trưng (*Văn, Đình, Hữu, Đức, Công, Bá, Trọng, Quang, Viết, Đăng, Khắc, Thế, Quốc...*) hoặc tên chính thuộc từ điển tên nam phổ biến (*Cường, Hiếu, Tuấn, Hùng, Thắng, Nam, Long, Quân, Huy, Phong, Hải, Hoàng, Tùng, Sơn, San, Thành, Đạt, Trung, Kiên, Phúc, Thiệu, Minh, Việt, Nghĩa, Khang, Khoa, Vũ, Tiến, Toàn, Lâm, Chiến, Thịnh...*).
   - Hỗ trợ chuẩn hoá chữ không dấu và xử lý tên đảo thứ tự (như "Bay Nguyen", "Lan Nguyen").

2. **Quy tắc thay thế đại từ (`formatPersonalizedMessage`)**:
   - **Khách là Nam**: Thay `Anh/chị`, `Anh/Chị` → `Anh`; thay `anh/chị`, `anh chị` → `anh`.
   - **Khách là Nữ**: Thay `Anh/chị`, `Anh/Chị` → `Chị`; thay `anh/chị`, `anh chị` → `chị`.
   - **Không xác định được Nam hay Nữ**: Bỏ trống danh xưng Anh/Chị, **điền đầy đủ cả họ tên của khách vào câu** (ví dụ: *"Em chào Bay Nguyen."*, *"Bay Nguyen nhắn em số zalo nhé."*, *"Bay Nguyen chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với Bay Nguyen ngay đây ạ."*).
   - **Không có tên (null / rỗng)**: Giữ nguyên câu mẫu mặc định (`"Anh/chị"`, `"anh/chị"`).

### 4.2 Trả lời tự do bằng AI (Gemini) khi khách hỏi ngoài kịch bản nút bấm

Vấn đề cần giải quyết: kịch bản cứng M1→M2→M3 chỉ đúng khi khách hỏi đúng 1 trong 3 chủ đề nút bấm (vị trí/pháp lý/giá). Khi khách hỏi tự do các câu thực tế khác (đường ô tô mấy mét, ngân hàng có hỗ trợ vay không, quy hoạch, từng lô giá bao nhiêu...), bot cũ không hiểu và chỉ lặp lại M3 khiến khách khó chịu. Mục này thay đúng phần đó bằng AI, **không đụng vào bất kỳ phần hạ tầng nào khác** (Sheet, Firestore, round-robin, ẩn comment, phoneValidator, reminder 20h — tất cả giữ nguyên 100% như mục 5-10).

**Phạm vi áp dụng — chỉ đúng 1 nhánh**: AI CHỈ được gọi khi khách nhắn tin tự do (hoặc comment) mà `phoneValidator` xác nhận **không có chuỗi số ứng viên nào** trong tin (mục 7 điểm 5) — tức đúng nhánh "chưa từng tương tác" (`NEW`) hoặc "hỏi lại/nhắn thêm" (`IN_PROGRESS`) ở mục 5.2/5.3. Các nhánh còn lại **không đổi, không dùng AI**:
- Bấm nút (`BTN_LOCATION`/`BTN_LEGAL`/`BTN_PRICE`) → vẫn trả lời M1→M2→M3 / M1→M4→M3 cố định như cũ (đã đúng ý, không có rủi ro AI bịa sai giá/pháp lý).
- Có chuỗi số ứng viên (hợp lệ hoặc không hợp lệ) → vẫn do `phoneValidator` + logic chốt lead/M6 quyết định, không qua AI.
- `CLOSED` → vẫn trả lời M7 cố định (mục 6), không gọi AI (khách đã bàn giao nhân viên, không cần AI tư vấn tiếp, đồng thời tiết kiệm chi phí gọi API cho các lead đã chốt).

**Nền tảng & lựa chọn model (tối giản chi phí — xem thêm mục 14)**: gọi trực tiếp **Gemini Developer API qua Google AI Studio** (KHÔNG dùng Vertex AI) bằng 1 API key riêng lấy từ AI Studio, model **`gemini-3.5-flash`**, chạy trong hạn mức **free tier** của Google (đủ dùng cho quy mô 1 fanpage). Gói thuê bao Google AI Pro/Ultra (Google One) nếu có **không cộng dồn quota vào lời gọi API backend** — chỉ tăng hạn mức dùng thử trong giao diện AI Studio (Playground/Build), nên chỉ dùng gói đó để thử prompt/kịch bản trước khi đưa vào code, không phải để chạy bot thật.

**`src/config/knowledgeBase.ts`**: nguồn dữ kiện **DUY NHẤT** AI được phép dùng để trả lời (vị trí, giá, pháp lý, tiện ích, chính sách thanh toán...). System instruction gửi cho Gemini phải nêu rõ: chỉ được trả lời dựa trên nội dung file này, **tuyệt đối không tự bịa thêm dữ kiện** (giá, pháp lý, cam kết) ngoài những gì có trong file. File này cũng là nơi duy nhất khai báo **số Zalo/điện thoại liên hệ của bên em** (`0916.060.254`) để AI cung cấp khi khách chủ động hỏi xin số liên hệ của bên em (khác với việc bot xin số của khách ở M3) — sửa số này ở đây nếu cần đổi, không hard-code rải rác nơi khác.

**`src/ai/geminiService.ts`** (lớp mỏng gọi API bên ngoài — chỉ test thủ công phần gọi API thật, xem mục 3):
- Export `generateAiReply(...)`: nhận câu hỏi mới nhất của khách, lịch sử hội thoại ngắn, tên khách. Bên trong tự phân tích giới tính bằng `genderDetector.analyzeVietnameseName` (mục 4.1) và đưa hướng dẫn xưng hô đúng ("anh"/"chị"/gọi thẳng tên nếu không xác định được, y hệt quy tắc mục 4.1) vào system instruction để AI tự viết câu trả lời với đúng đại từ — **không** áp dụng `formatPersonalizedMessage` lên văn bản do AI sinh ra (hàm đó chỉ thay thế đúng chuỗi mẫu "Anh/chị" cố định, không có tác dụng với câu AI tự do viết).
- Export `buildSystemInstruction(...)`: hàm thuần lắp ráp system prompt (knowledge base + quy tắc xưng hô + quy tắc không bịa) — tách riêng khỏi phần gọi API để unit test được (mục 13).
- Lời gọi API thật bọc `withRetry` (mục 10) như mọi lời gọi ra ngoài khác.

**Bắt buộc — CTA xin số Zalo do CODE tự thêm, không giao cho AI**: dù AI trả lời nội dung gì, lớp gọi ngoài (`webhook/facebook.ts`) **luôn tự gửi thêm cứng dòng M3** ngay sau câu trả lời AI — không dựa vào việc AI có "tự giác" nhắc xin số hay không. Đây là nguyên tắc bắt buộc để mục tiêu chốt lead của toàn dự án không bao giờ bị ảnh hưởng bởi việc AI trả lời lệch hướng hoặc quên nhắc.

**Fallback bắt buộc khi Gemini lỗi**: nếu lời gọi `generateAiReply` thất bại (đã qua hết số lần retry của `withRetry`, mục 10) hoặc trả về chuỗi rỗng, bot **không được im lặng** — dùng lại nguyên văn M2 (`messages.json`) làm câu trả lời thay thế, đồng thời `logError` (mục 10) để theo dõi tần suất fallback.

**Lịch sử hội thoại cho AI**: lưu tại `conversations.aiHistory` trong Firestore (mảng `{ role: 'user' | 'model', text: string }`, chỉ giữ tối đa 10 phần tử gần nhất ≈ 5 lượt qua lại, phần tử cũ hơn bị cắt bỏ khi ghi thêm) để AI trả lời có ngữ cảnh mà không tốn token vô hạn. Trường này **không bao giờ chứa số điện thoại thật của khách** — vì theo đúng thứ tự đánh giá ở mục 5.2/5.3 (không đổi), nhánh AI chỉ được gọi tới sau khi `phoneValidator` đã xác nhận tin nhắn **không có** chuỗi số ứng viên nào.

**Cách flowEngine.ts (vẫn là hàm thuần, không gọi API — mục 3) phối hợp với AI**: `processInput` không tự gọi Gemini. Khi cần 1 câu trả lời tự do, nó chỉ đặt giá trị đặc biệt **`'AI_REPLY'`** vào đúng vị trí trong mảng `messagesToSend` (giá trị này không phải khoá trong `messages.json`). Chỉ lớp gọi ngoài (`webhook/facebook.ts`) mới hiểu `'AI_REPLY'` là tín hiệu để gọi sang `geminiService.generateAiReply(...)` thay vì tra `messages.json` — giữ đúng ranh giới "flowEngine thuần, không gọi API bên ngoài" đã quy định từ đầu dự án.

---

## 5. Luồng hội thoại Messenger

### 5.1 Khi khách mở cửa sổ chat lần đầu

Gửi ngay 1 tin có 3 quick-reply button, payload cố định:

| Nút hiển thị | Payload |
|---|---|
| Ở đâu? | `BTN_LOCATION` |
| Có sổ đỏ không? | `BTN_LEGAL` |
| Giá bao nhiêu? | `BTN_PRICE` |

### 5.2 Bảng luồng theo trigger (R1)

| Trigger | Điều kiện | Trả lời (theo thứ tự) |
|---|---|---|
| Bấm `BTN_LOCATION` | — | M1 → M2 → M3 |
| Bấm `BTN_PRICE` | — | M1 → M2 → M3 |
| Bấm `BTN_LEGAL` | — | M1 → M4 → M3 |
| Nhắn tin tự do (không phải bấm nút, không chứa số điện thoại) | conversation state = `NEW` (chưa từng chạy luồng) | M1 → **AI trả lời đúng câu hỏi của khách** (dựa trên `knowledgeBase.ts`, mục 4.2) → M3 — thay vì luôn cứng M2, AI trả lời đúng trọng tâm khách vừa hỏi |
| Nhắn tin tự do, quét không thấy chuỗi số ứng viên nào trong tin (kể cả sau đó sẽ không hợp lệ) | conversation state = `IN_PROGRESS` (đã gửi đủ M1-M3/M1-M4-M3 nhưng chưa có số hợp lệ) | Khách **"nhắn thêm dòng thứ 2" / "hỏi lại"**: **AI trả lời đúng câu hỏi mới** (mục 4.2) rồi gửi thêm M3 xin số zalo (không gửi lại M1), cập nhật `lastFlowSentAt`. Mỗi tin tự do tiếp theo mà vẫn chưa có số hợp lệ đều lặp lại đúng cặp (AI trả lời → M3) |
| Nhắn tin tự do, KHÔNG có số điện thoại hoặc có số điện thoại **giống hệt** số đã ghi | conversation state = `CLOSED` (xem mục 6) | Trả lời M7, không tạo lead mới, không đổi số — copy nguyên trạng dòng lead cũ sang tab "Hỏi lại" (mục 6, 8c) |
| Nhắn tin tự do có số điện thoại **hợp lệ nhưng KHÁC** số đã ghi | conversation state = `CLOSED` (xem mục 6) | Coi là khách **sửa số**: sửa lại cột B của dòng lead cũ trên tab tháng gốc + cập nhật hồ sơ Firestore, rồi copy dòng đã sửa sang tab "Hỏi lại" (mục 8c), trả lời M7 |
| Nhắn tin tự do có chuỗi số nhưng **sai định dạng** (thiếu/thừa/sai đầu số) | conversation state = `CLOSED` (xem mục 6) | Trả lời M6 tương ứng — **tuyệt đối không đụng Sheet** ở nhánh này (kể cả tab "Hỏi lại"), giống hệt nguyên tắc áp dụng khi chưa `CLOSED` |
| Tin nhắn chứa số điện thoại **được `phoneValidator` xác nhận CHÍNH XÁC hợp lệ** (đúng cả độ dài lẫn đầu số) | state ≠ `CLOSED` | Chỉ khi đến bước này mới được phép tác động vào Sheet: chạy luồng chốt lead — ghi Sheet (mục 8) → phân bổ NV vào cột F (mục 9) → trả lời khách M5 → set state = `CLOSED` |
| Tin nhắn chứa số điện thoại **không hợp lệ** — thiếu số, thừa số, hoặc đúng 10 số nhưng sai đầu số | state ≠ `CLOSED` | Trả lời M6 tương ứng ("thiếu" / "thừa" / "chưa đúng định dạng"). **Tuyệt đối không ghi, sửa, hay xoá bất kỳ ô/cột nào trong Sheet** ở nhánh này. State giữ nguyên |

Thứ tự đánh giá trên 1 tin nhắn tự do (tránh chồng chéo giữa các nhánh trên): (1) `CLOSED` luôn được kiểm tra ĐẦU TIÊN — nhưng vẫn quét số điện thoại trong tin để phân biệt 3 nhánh CLOSED phía trên (sai định dạng / số khác cũ / số giống cũ hoặc không có số), không còn "bỏ qua nội dung" như thiết kế trước; (2) nếu chưa `CLOSED`, quét chuỗi số liên tiếp ≥ 8 ký tự (mục 7, điểm 5) — nếu có, ưu tiên xử lý theo 2 nhánh "số điện thoại hợp lệ/không hợp lệ" phía dưới; (3) chỉ khi không có chuỗi số ứng viên nào mới xét tới state còn lại (`NEW` → gửi M1 → AI trả lời → M3, `IN_PROGRESS` → AI trả lời → M3, mục 4.2). Thứ tự này không đổi so với thiết kế gốc — lớp AI (mục 4.2) chỉ thay ĐÚNG phần nội dung câu trả lời ở bước (3), không thay đổi cách xác định khi nào tới lượt bước (3) chạy.

**Lưu ý triển khai**: nhánh "chốt lead khi có số điện thoại hợp lệ" nên được viết thành một hàm dùng chung duy nhất trong `flowEngine.ts` (ví dụ `closeLeadWithPhone(psid, phone, customerName)`), để mục 5.3 (chốt lead ngay từ comment) tái sử dụng lại đúng hàm này thay vì cài đặt trùng lặp — tránh 2 nơi xử lý lệch nhau theo thời gian.

### 5.3 Luồng comment trên Page (R2)

Khi có comment mới dưới bài đăng của Page (webhook field `feed`): trước tiên áp dụng **cùng `phoneValidator`** lên nội dung comment (cùng ngưỡng "chuỗi số liên tiếp ≥ 8 ký tự" ở mục 7, điểm 5) để quét xem khách có để lại số điện thoại ngay trong comment hay không, rồi mới quyết định nhánh xử lý:

| Kết quả quét comment | Xử lý |
|---|---|
| Có chuỗi số ứng viên, `phoneValidator` trả `valid === true` | **Chốt lead ngay từ comment**, không cần chờ khách nhắn tin riêng: gọi đúng hàm chốt lead dùng chung với mục 5.2 (`closeLeadWithPhone`) — ghi Sheet (mục 8, cột C lấy theo tên hiển thị `from.name` của comment) → phân bổ NV cột F (mục 9) → gửi **Private Reply** M5 → set state = `CLOSED` cho PSID tương ứng. Không gửi M1-M3 trước đó |
| Có chuỗi số ứng viên nhưng `phoneValidator` trả `valid === false` (thiếu/thừa/sai đầu số) | Gửi **Private Reply** M6 tương ứng, **không tác động Sheet** — giữ đúng nguyên tắc mục 7 điểm 6 |
| Không có chuỗi số ứng viên nào trong comment | Gửi **Private Reply** M1 → **AI trả lời đúng câu hỏi trong comment** (mục 4.2) → M3, dùng chung `flowEngine.ts` / state theo PSID như mục 5.2 (nếu PSID này đã `IN_PROGRESS` từ trước — vd đã hỏi qua tin nhắn — thì chỉ gửi AI trả lời → M3, không gửi lại M1) |

Trong cả 3 trường hợp, sau khi PSID được phân giải từ comment, mọi tương tác tiếp theo của khách (chat trực tiếp hoặc comment thêm) đều dùng chung state theo PSID như mục 5.2/6: nếu vẫn ở `IN_PROGRESS` (chưa cho số) và khách hỏi lại / nhắn lại — bất kể qua kênh nào (nhắn tin vào Page hay comment thêm) — **AI trả lời đúng câu hỏi mới rồi gửi thêm M3** xin số zalo (mục 4.2); nếu đã `CLOSED` (đã có số điện thoại hợp lệ), khách hỏi lại qua bất kỳ kênh nào cũng chỉ nhận M7 cố định (không gọi AI, mục 4.2) và không tạo lead mới (mục 6) — không còn tuyệt đối im lặng, nhưng cũng không xử lý lại như một lượt hỏi mới.

> **Tự động ẩn bình luận sau khi nhắn tin (Auto-hide comment)**: Để bảo vệ thông tin khách hàng (số điện thoại) và tránh bị đối thủ quét bài cướp lead, ngay sau khi bot hoàn thành việc gửi Private Reply cho khách xong (ở tất cả các nhánh: có số, không số, hay sai định dạng), bot tự động gọi Facebook Graph API `POST /v19.0/{comment_id}?is_hidden=true` để ẩn bình luận trên bài viết công khai đi ngay lập tức.

### 5.4 Rà soát & gửi tin nhắn nhắc lúc 20h hàng ngày (`src/services/reminderService.ts`)

- **Thời điểm kích hoạt**: Đúng 20:00 hàng ngày theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh` / UTC+7).
- **Đối tượng**: Toàn bộ khách hàng có tương tác nhắn tin trong khung giờ từ **20h01 ngày hôm trước đến 20h00 ngày hôm sau** mà **chưa cho số điện thoại** (`state !== 'CLOSED'` và chưa có số điện thoại hợp lệ).
- **Nội dung tin nhắn**:
  > *"Thứ 7 này em có xe đưa đón xem đất miễn phí, anh/chị có đi được không ạ?"*
  *(Tự động cá nhân hoá theo giới tính: Nam → "anh", Nữ → "chị", Không rõ Nam/Nữ → điền đầy đủ cả họ tên khách, Chưa có tên → "anh/chị")*.
- **Cơ chế chống lỗi vòng lặp & chống lệnh chồng chéo (Concurrency Guard)**:
  1. **Khóa phân tán cấp ngày (`dailyReminderSweep:${todayStr}`)**: Ngăn chặn 2 tiến trình hoặc nhiều container Cloud Run cùng chạy sweep một lúc.
  2. **Tránh gửi lặp cho cùng 1 khách (`lastReminderSentDate`)**: Lưu trường ngày gửi vào Firestore, nếu đã gửi trong ngày thì tuyệt đối bỏ qua.
  3. **Khóa theo khách hàng (`psid:${psid}`)**: Tránh xung đột nếu khách nhắn tin phản hồi vào đúng lúc bot đang quét.
  4. **Chặn vòng lặp phản hồi tin nhắn của chính Page**: Kiểm tra `if (pageId && event.sender.id === pageId) continue;` và `is_echo` để bot không bao giờ xử lý tin nhắn do chính mình phát ra.
- **Kênh kích hoạt kép**:
  - Tự động chạy ngầm qua scheduler mỗi phút trong container khi đến 20:00 VN.
  - Endpoint HTTP: `GET/POST /cron/daily-reminder` (hỗ trợ `?force=true`, `?dryRun=true`) để kích hoạt qua Cloud Scheduler hoặc gọi thủ công khi cần.

---

## 6. Trạng thái hội thoại & chống lặp/spam (R3)

Lưu theo PSID (Page-Scoped ID) trong Firestore, collection `conversations`, document ID = PSID:

```
{
  state: "NEW" | "IN_PROGRESS" | "CLOSED",
  lastFlowSentAt: Timestamp,
  phone: string | null,
  assignedStaff: string | null,
  customerName?: string | null,
  lastReminderSentDate?: string | null
}
```

- `NEW`: chưa từng nhận M1-M3/M1-M4-M3.
- `IN_PROGRESS`: đã gửi đủ bộ 3 tin, chưa có số điện thoại hợp lệ.
- `CLOSED`: đã có số điện thoại hợp lệ và đã gán nhân viên phụ trách (ghi cột F) — bàn giao cho nhân viên xử lý tiếp (kênh báo cho nhân viên nằm ngoài phạm vi bản này). **Từ thời điểm này bot không còn tạo lead mới trên tab tháng nữa**, nhưng KHÔNG im lặng tuyệt đối như bản cũ — khách nhắn tiếp bất kỳ nội dung gì được xử lý theo 3 nhánh (xem AC6):
  - Tin nhắn có chuỗi số nhưng **sai định dạng** (thiếu/thừa/sai đầu số, mục 7) → trả lời M6 tương ứng (mục 7 điểm 6: tuyệt đối không đụng Sheet ở nhánh này, kể cả tab "Hỏi lại"), state và số điện thoại giữ nguyên.
  - Tin nhắn có số điện thoại **hợp lệ nhưng KHÁC** số đã ghi trước đó → coi là khách **sửa số**: cập nhật `phone` trên hồ sơ Firestore của khách **và** sửa lại cột B của dòng lead cũ trên tab tháng gốc, rồi copy dòng đã sửa sang tab "Hỏi lại" (mục 8c), trả lời M7.
  - Mọi trường hợp còn lại (không có số, hoặc số hợp lệ giống hệt số cũ) → giữ nguyên số/state, copy nguyên trạng dòng lead cũ sang tab "Hỏi lại" (mục 8c), trả lời M7 ("Dạ, em đã có số điện thoại của anh/chị và chuyển đến cho nhân viên phụ trách...").
- Khi state = `IN_PROGRESS` và khách nhắn tiếp một tin không chứa chuỗi số ứng viên nào (mục 7, điểm 5): coi là khách **"hỏi lại"** — **AI trả lời đúng câu hỏi mới của khách** dựa trên `knowledgeBase.ts` (mục 4.2) rồi gửi thêm M3 xin số zalo, cập nhật `lastFlowSentAt`. Hành vi này lặp lại không giới hạn số lần cho tới khi khách gửi số điện thoại hợp lệ (state chuyển `CLOSED`) hoặc không hợp lệ (trả lời M6, state giữ `IN_PROGRESS`, xem mục 5.2).

---

## 7. Chuẩn hoá & xác thực số điện thoại (R4)

`phoneValidator.ts` (hàm thuần, không gọi API bên ngoài — xem mục 3):

1. Loại bỏ khoảng trắng, dấu `-`, `.`.
2. Nếu bắt đầu bằng `+84` hoặc `84`, chuyển về dạng bắt đầu bằng `0`.
3. Regex đầu số hợp lệ: `^0(3|5|7|8|9)\d{8}$` (đúng 10 chữ số).
4. Nếu độ dài < 10 → phản hồi M6 với "thiếu"; nếu > 10 → M6 với "thừa"; nếu đúng 10 số nhưng sai đầu số → coi như không phải số điện thoại hợp lệ, xử lý M6 dạng chung (không phân biệt thiếu/thừa, ghi "chưa đúng định dạng").
5. Chỉ chạy validator trên tin nhắn có chuỗi số liên tiếp ≥ 8 ký tự, tránh nhận nhầm câu chat thường có vài chữ số.
6. **Nguyên tắc bắt buộc**: hàm trả về kết quả dạng `{ valid: boolean, normalizedPhone: string | null, errorType: "missing" | "excess" | "invalidPrefix" | null }`. Toàn bộ phần còn lại của hệ thống (webhook, `flowEngine.ts`) **chỉ được phép gọi sang `sheetsService.appendLead()` khi `valid === true`**. Bất kỳ giá trị `valid === false` nào (thiếu số, thừa số, sai đầu số, hay không đủ điều kiện để coi là số điện thoại) đều phải dừng lại ở bước trả lời M6 — không có ngoại lệ, không ghi tạm/ghi nháp vào Sheet rồi sửa lại sau.

---

## 8. Ghi Google Sheet (R5)

`sheetsService.appendLead(row)` — dùng Sheets API `values.append`, **không format lại sheet, không chèn công thức** — chỉ ghi giá trị thô vào dòng trống tiếp theo của đúng tab tháng tương ứng (mục 8b). Bot tự động ghi các cột **A, B, C, E, F** cho mọi lead; cột D, G để trống chờ nhân viên điền tay (xem mục 1); **cột H không thuộc phạm vi dự án** (xem bảng dưới).

**Điều kiện bắt buộc trước khi gọi hàm này**: `appendLead()` chỉ được `flowEngine.ts` gọi tới sau khi `phoneValidator` trả về `valid === true` (mục 7, điểm 6). Số điện thoại thiếu số, thừa số, sai đầu số, hoặc bất kỳ trường hợp không chắc chắn nào khác đều **không được phép làm phát sinh bất kỳ thay đổi nào trên Sheet** — không thêm dòng, không ghi ô, không cập nhật dòng đã có. Trang tính chỉ có tác động khi và chỉ khi số điện thoại đã được xác định chính xác là hợp lệ.

> **Đã bỏ khỏi dự án theo yêu cầu chủ dự án**: việc lấy link Facebook cá nhân của khách để ghi vào cột H — bỏ hoàn toàn, kể cả phương án tự động (dựng link từ `from.id` của comment) lẫn phương án thủ công (nhân viên copy tay từ hộp thư Page). Bot không đọc, không xử lý, không ghi bất cứ gì vào cột H. Đã xác nhận lại quyết định này dù Sheet thật đang có cột "Facebook" đã dùng — giữ nguyên hiện trạng, không đảo ngược.

Header thật trên Sheet production (tab "Tháng 9" làm form mẫu): A=Ngày, B=SĐT, C=Tên khách, D=Địa chỉ, E=Nguồn khách, F=Sale, G=Tư vấn, H=Facebook.

| Cột | Tên trên Sheet | Nội dung | Nguồn dữ liệu | Ai điền |
|---|---|---|---|---|
| A | Ngày | Ngày/tháng ghi nhận (dd/mm) | Thời điểm server ghi nhận | Bot (tự động) |
| B | SĐT | Số điện thoại chuẩn 10 số | Đã qua `phoneValidator` | Bot (tự động) |
| C | Tên khách | Tên khách, viết đúng thứ tự họ tên Việt Nam (Họ + tên đệm + tên gọi) | Xem ghi chú ngay dưới bảng | Bot (tự động) |
| D | Địa chỉ | Tỉnh/thành của khách | Facebook không cung cấp field địa chỉ/quê quán qua Graph API nên bot không tự điền được. Nhân viên có thể bổ sung tay nếu thấy khách tự nói ra trong chat | Nhân viên (thủ công, không bắt buộc) |
| E | Nguồn khách | Kênh tạo ra lead — dropdown có sẵn: Tin nhắn/Hotline/Cmt/Trang cá nhân khách/Quét số | Bot chọn đúng 1 trong các giá trị dropdown **sẵn có** của cột E theo kênh phát sinh số điện thoại hợp lệ: số đến từ tin nhắn Messenger trực tiếp → `"Tin nhắn"`; số đến ngay trong nội dung comment trên Page → `"Cmt"`. Bot không tự suy ra 3 giá trị còn lại (Hotline/Trang cá nhân khách/Quét số) vì không có kênh nào trong dự án tạo ra 2 loại lead này | Bot (tự động) |
| F | Sale | Tên nhân viên phụ trách | Kết quả `sheetsService.pickNextStaff` — mục 9 | Bot (tự động, chỉ khi ô đang trống) |
| G | Tư vấn | Ghi chú tư vấn | Nội dung phát sinh sau khi nhân viên trực tiếp trao đổi với khách, bot không có dữ liệu này | Nhân viên (thủ công) |
| H | Facebook | Link Facebook khách | **Ngoài phạm vi dự án — đã bỏ, giữ nguyên quyết định dù Sheet thật đã dùng cột này.** | Nhân viên (thủ công, ngoài hệ thống bot) |

**Ghi chú nguồn dữ liệu cột C (Cơ chế lấy tên khách hàng tự động không cần App Review)**:
- Thay vì gọi cổng hồ sơ cá nhân `GET /{psid}?fields=first_name,last_name` (bị Meta siết quyền riêng tư, yêu cầu App Review và xác minh doanh nghiệp), bot sử dụng đặc quyền Admin của Page để truy vấn trực tiếp hộp thư cuộc trò chuyện:
  `GET /v19.0/me/conversations?user_id={psid}&fields=participants,senders`
  → Trả về đầy đủ và chính xác 100% họ tên hiển thị thật của người nhắn (`participants.data[].name`) đối với cả người lạ mà không bị Meta chặn và không cần xét duyệt.
- Fallback: nếu gọi qua conversation không thấy hoặc với tài khoản tester, bot fallback sang `/{psid}?fields=first_name,last_name` (ghép `last_name` trước để ra đúng thứ tự "Nguyễn Văn A").
- Với comment trên Page: đọc trực tiếp `from.name`.
- **Trang tính Google Sheet kết nối**: `KD1 - 09/2026` (ID: `157OJYSz-8nXNpy6YHkL1Pf8KCtecdggxaJBQ6sujkcA`).

**Ghi chú nguồn dữ liệu cột E (nguồn khách)**: khác với cột F (đọc live danh sách dropdown vì là 1 danh sách nhân sự có thể đổi bất kỳ lúc nào — mục 9), cột E chỉ nhận đúng 1 trong 2 giá trị cố định do bot tự phân loại theo kênh, ghi thẳng bằng chuỗi ký tự khớp đúng chính tả với nhãn dropdown đã có trên Sheet (`"Tin nhắn"`, `"Cmt"`) — không đọc lại danh sách dropdown của cột E để đối chiếu trước khi ghi. Nếu sau này nhân viên đổi chính tả 2 nhãn này trên dropdown (vd "Tin nhắn" → "Nhắn tin"), giá trị bot ghi vẫn qua được API (Sheets API không chặn ghi trái dữ liệu hợp lệ) nhưng sẽ không khớp danh sách hiển thị trên UI — cần đồng bộ lại chuỗi cứng trong code nếu đổi nhãn dropdown (giới hạn kỹ thuật, xem mục 14). Cột E được ghi bằng 1 lệnh `values.update` **tách riêng khỏi cột A-C** (không gộp thành 1 vùng A:E) để tuyệt đối không đụng cột D xen giữa.

### 8b. Nhiều tab theo tháng (mở rộng theo yêu cầu chủ dự án)

Sheet production dùng 1 tab riêng cho mỗi giai đoạn, không ghi tất cả vào 1 tab duy nhất. `sheetsService.resolveTargetSheetName(date)` chọn tab đích theo tháng nhận lead:

- Lead nhận trong **tháng 8 hoặc tháng 9** → ghi vào tab **"Tháng 9"** (giai đoạn chuyển đổi khi bot mới chạy, gộp chung 1 tab).
- Lead nhận trong **tháng 10** → ghi vào tab **"Tháng 10"**.
- Các tháng tiếp theo (11, 12, ...) → ghi vào tab **"Tháng {N}"** tương ứng, **tự động tạo tab nếu chưa tồn tại**.

Tab **"Tháng 9" là form mẫu chuẩn** cho toàn bộ dự án ("tất cả theo form của tháng 9"). Khi cần tạo tab tháng mới, `ensureSheetExists()` nhân bản (`duplicateSheet`) từ tab "Tháng 9", sau đó xoá text mẫu từ dòng 2 trở đi ở **cột A-E, F và G** — tab mới bắt đầu trống dữ liệu ở các cột này (không còn giữ lại bản copy F từ tab mẫu như trước nữa, xem mục 9: round-robin giờ tự nối tiếp sang tab tháng liền trước thay vì dựa vào giá trị F chép sẵn). **Tuyệt đối không đụng cột H** ở bất kỳ tab nào, kể cả khi xoá dữ liệu mẫu lúc tạo tab mới (mục 8/14 — ngoài phạm vi dự án, giữ nguyên bất kể nội dung mẫu là gì). Chỉ xoá **nội dung ô**, không đụng định dạng/data validation (dropdown) ở bất kỳ cột nào — dropdown cột F vẫn giữ nguyên để còn đọc danh sách nhân sự (mục 9).

Tab **"Tháng 9"** là ngoại lệ duy nhất: đây là tab gốc, cột F của nó **là dữ liệu thật** do nhân viên pre-fill sẵn từ trước khi có bot (không phải bản copy tự động) — nguyên tắc "giữ nguyên giá trị F đã có, không ghi đè" ở mục 9 áp dụng cho tab này như bình thường.

### 8c. Theo dõi khách "hỏi lại" sau khi đã CLOSED (tab "Hỏi lại")

Khi khách đã `CLOSED` (đã cho số điện thoại hợp lệ, đã gán nhân viên) nhắn tiếp bất kỳ nội dung gì — dù qua tin nhắn Messenger hay comment thêm — và tin nhắn đó **không phải 1 lần gõ sai định dạng số điện thoại** (mục 6, 7): bot trả lời M7 rồi thực hiện thêm bước sau, tách biệt hoàn toàn khỏi luồng chốt lead ở mục 8:

1. Quét ngay nội dung tin nhắn/comment bằng `phoneValidator` (cùng ngưỡng "chuỗi số liên tiếp ≥ 8 ký tự" ở mục 7 điểm 5):
   - Có số điện thoại **hợp lệ** và **khác** số đã ghi trên hồ sơ khách (`conversations.phone`) → đây là 1 lần khách **sửa số điện thoại**. Cập nhật `conversations.phone` sang số mới, đồng thời **ghi đè cột B (SĐT)** của đúng dòng lead cũ trên tab tháng gốc sang số mới — **chỉ sửa cột B**, giữ nguyên mọi cột khác (tên khách, nguồn khách, nhân viên phụ trách...).
   - Không có số, hoặc có số nhưng **giống hệt** số đã ghi → giữ nguyên `conversations.phone`, không sửa gì trên tab tháng gốc.
2. Tìm dòng lead cũ theo số điện thoại (số **đã cập nhật** nếu vừa sửa ở bước 1, hoặc số cũ nếu không sửa) bằng cách quét cột B của **tất cả các tab "Tháng {N}"** hiện có trên trang tính (không quét tab "Hỏi lại"). Dừng lại ngay khi tìm thấy dòng đầu tiên khớp.
3. Copy **toàn bộ giá trị cột A-H** của dòng tìm được (đã phản ánh đúng số điện thoại mới nếu vừa sửa ở bước 1).
4. Dán vào tab **"Hỏi lại"** — tự dò dòng trống tiếp theo tính từ dòng 2 theo CỘT B (dòng nào đã có SĐT thì bỏ qua, chuyển xuống dòng kế tiếp để dán, giống hệt cách dò dòng trống khi ghi lead mới ở mục 8).

**Giả định quan trọng**: tab **"Hỏi lại" phải được tạo sẵn thủ công** trên Sheet thật (cùng header A-H như các tab tháng) — bot **không tự tạo** tab này như cách tự tạo tab tháng mới ở mục 8b. Nếu tab "Hỏi lại" chưa tồn tại, thao tác ghi sẽ lỗi và được log vào Firestore `errors` (mục 10) để xử lý thủ công, không làm mất dữ liệu khách đã chốt lead trước đó (lead gốc trên tab tháng không bị ảnh hưởng).

Nếu không tìm thấy dòng lead cũ nào khớp số điện thoại đang tra cứu ở bất kỳ tab tháng nào (trường hợp hiếm — ví dụ lần ghi lead gốc trước đó bị lỗi và chỉ được log lỗi chứ chưa lên được Sheet, xem mục 10), thao tác cũng log lỗi tương tự, không tự tạo dòng "khống" trên tab "Hỏi lại" và không sửa gì trên tab tháng.

**Debounce 30 phút cho trường hợp KHÔNG có gì mới** (cập nhật quyết định — trước đây "không chống trùng lặp tuyệt đối", nay chủ dự án yêu cầu chặn bớt dòng rác khi khách chat qua lại dồn dập): chỉ áp dụng cho nhánh khách **không sửa số điện thoại** (không có số, hoặc số giống hệt số cũ) ở bước 1 phía trên. Bot lưu thêm `conversations.lastFollowUpTrackedAt` = lần gần nhất **thực sự** ghi 1 dòng vào tab "Hỏi lại" cho khách đó (khác `lastFlowSentAt` — field đó vẫn cập nhật ở MỌI lượt, phục vụ cửa sổ quét của `reminderService`, mục 5.4, không dùng chung cho debounce này):
- Nếu khách nhắn/comment lại mà **chưa đủ 30 phút** kể từ `lastFollowUpTrackedAt` → bỏ qua hoàn toàn bước 2-4, **không** tạo dòng mới trên tab "Hỏi lại" (khách vẫn nhận M7 bình thường ở bước trả lời, chỉ riêng thao tác ghi Sheet bị chặn).
- Nếu đã đủ 30 phút (hoặc đây là lần "hỏi lại" đầu tiên, `lastFollowUpTrackedAt` chưa từng có) → thực hiện đủ bước 2-4 như bình thường, rồi cập nhật `lastFollowUpTrackedAt` = thời điểm ghi xong.

**Sửa số điện thoại luôn được ghi ngay, không qua debounce**: nhánh khách gửi số **hợp lệ nhưng khác** số cũ (sửa số) ở bước 1 là thông tin thật sự mới đối với nhân viên — luôn thực hiện đủ bước 1-4 ngay lập tức bất kể `lastFollowUpTrackedAt` gần đây thế nào, đồng thời vẫn cập nhật lại `lastFollowUpTrackedAt` sau khi ghi xong.

Mỗi lần THỰC SỰ ghi (không bị debounce chặn) đều tạo **thêm 1 dòng mới** trên tab "Hỏi lại" — không có cơ chế gộp theo số điện thoại giữa các lần ghi cách nhau trên 30 phút; mỗi dòng vẫn đại diện cho 1 lần khách chủ động hỏi lại/sửa số, giúp nhân viên thấy được tần suất mà không bị ngập dòng rác từ các tin nhắn dồn dập không có gì mới.

Khoá: sửa cột B trên tab tháng gốc khoá theo tên tab đó (giống `appendLead`, R7); ghi vào tab "Hỏi lại" khoá riêng theo tên tab "Hỏi lại" — 2 khách khác nhau cùng hỏi lại/sửa số gần như đồng thời không được cùng đọc "dòng trống kế tiếp" của tab "Hỏi lại" rồi ghi đè lên nhau, cũng như không đụng độ với 1 lead khác đang được ghi/đọc trên cùng tab tháng.

---

## 9. Phân bổ round-robin (R6)

**Nguồn dữ liệu nhân sự = chính dropdown (data validation) của cột F** trên tab đang ghi lead — không dùng file cấu hình tĩnh (`staff.json` đã bị bỏ). Khi danh sách dropdown được sửa trực tiếp trên Sheet (thêm/bớt người), lần ghi lead tiếp theo tự động dùng danh sách mới nhất, không cần sửa code hay deploy lại.

Thuật toán (`sheetsService.pickNextStaff` + `findLastValidAssignment`, đều là hàm thuần — mục 3): người phụ trách của dòng mới = người **ngay sau người hợp lệ được ghi gần nhất** trong dropdown hiện tại của cột F, không phải theo số thứ tự dòng cố định. Việc tìm "người gần nhất" **không dừng lại ở tab đang ghi** — nếu tab hiện tại chưa có lịch sử hợp lệ nào (vd lead đầu tiên của 1 tháng mới, cột F còn trống hoàn toàn — xem mục 8b), thuật toán lùi sang tab tháng liền trước để tiếp tục tìm, đảm bảo thứ tự luân phiên không bị ngắt quãng hay "reset" giữa các tháng:

```
dropdownList = danh sách dropdown cột F hiện tại (đọc live tại thời điểm ghi, trên tab đang ghi lead)

hàm findLastValidAssignment(tabName):
  nếu tabName không tồn tại trên Sheet (tháng đó chưa từng có lead nào nên chưa được tạo)
      -> return findLastValidAssignment(tabTruoc(tabName))   // bỏ qua, lùi thêm 1 tháng
  quét ngược cột F của tabName từ dòng cuối có dữ liệu lên dòng 2, bỏ qua ô trống VÀ bỏ qua luôn
  giá trị của người đã bị xoá khỏi dropdownList hiện tại -> nếu tìm thấy người hợp lệ, trả về người đó
  nếu quét hết tabName mà không thấy ai hợp lệ:
      nếu tabName == "Tháng 9" (tab gốc, không có tab nào trước đó) -> return null
      ngược lại -> return findLastValidAssignment(tabTruoc(tabName))   // đệ quy lùi tiếp

lastAssigned = findLastValidAssignment(tabName đang ghi lead)

nếu lastAssigned == null (chưa từng có ai hợp lệ được ghi ở bất kỳ tab nào) -> assignedStaff = dropdownList[0]
ngược lại                                                                   -> assignedStaff = dropdownList[(index(lastAssigned) + 1) % dropdownList.length]
```

(`tabTruoc("Tháng 10")` = `"Tháng 9"`, `tabTruoc("Tháng 11")` = `"Tháng 10"`, v.v. — suy ra trực tiếp từ số thứ tự tháng trong tên tab.)

Điểm quan trọng: nếu đúng người được ghi **gần nhất** đã bị xoá khỏi dropdown, thuật toán **không** nhảy thẳng về đầu danh sách — mà tiếp tục quét lên các dòng trước đó (kể cả sang tab tháng trước nếu cần) để tìm người hợp lệ gần nhất còn lại, rồi tiếp nối đúng vị trí luân phiên từ người đó. Chỉ khi toàn bộ lịch sử ở mọi tab (lùi tới tận "Tháng 9") đều là người đã bị xoá hoặc chưa có lịch sử mới quay về `dropdownList[0]`.

Quy trình ghi 1 lead (`sheetsService.appendLead`):
1. Tự dò dòng trống tiếp theo tính từ dòng 2 theo CỘT B (`findNextEmptyRowByColumnB`, tuyệt đối không so sánh hay phụ thuộc vào Cột A) rồi ghi cột A-C (Ngày, SĐT, Tên khách) — **không đụng cột D-H** của dòng đó.
2. Ghi cột E (Nguồn khách) của đúng dòng đó bằng 1 lệnh riêng: `"Tin nhắn"` nếu lead đến từ tin nhắn Messenger, `"Cmt"` nếu đến từ comment (mục 8) — luôn ghi thẳng, không cần đọc trước vì đây là dòng vừa append nên cột E chắc chắn đang trống.
3. Đọc cột F của đúng dòng vừa ghi: nếu **đã có sẵn giá trị** (chỉ xảy ra trên tab "Tháng 9" — dữ liệu pre-fill thật từ trước khi có bot, xem mục 8b) → giữ nguyên, dùng luôn giá trị đó, không ghi đè.
4. Nếu F đang **trống** → tính `assignedStaff` theo thuật toán trên rồi ghi vào đúng ô F đó.

Cách này tự thích ứng khi dropdown thêm/bớt người mà không bị lệch, và không cần Firestore đếm cứng (`state/roundRobin` không còn được dùng). Đánh đổi đã được chủ dự án chấp nhận: nếu ai đó xoá/sửa tay dòng đã ghi trong Sheet, "người gần nhất" có thể bị lệch — chấp nhận được vì khớp đúng cách vận hành thật của Sheet (cột F của tab "Tháng 9" vốn đã được nhân viên pre-fill sẵn theo chu kỳ dropdown từ trước khi có bot; các tab tháng sau do bot tự tạo trống hoàn toàn ở cột F, xem mục 8b).

---

## 10. Xử lý lỗi & logging (R7)

- Mọi lời gọi ra ngoài (Facebook Send API, Sheets API) đều wrap try/catch, retry tối đa 3 lần với backoff tăng dần khi lỗi mạng/5xx — retry theo từng lệnh gọi riêng lẻ, không retry cả 1 chuỗi nhiều bước (tránh lặp lại bước đã thành công khi bước sau thất bại, vd ghi trùng lead vào Sheet).
- Nếu ghi Sheet thất bại: **không được để mất lead** — ghi log lỗi (Firestore collection `errors` hoặc console log có cấu trúc) kèm đủ thông tin để xử lý thủ công.
- Không để một lỗi ở bước sau làm rollback hay chặn bước trước đã thành công.
- **Không để lệnh chồng chéo (concurrent) gây lỗi**: mọi thao tác đọc-tính-ghi trên state dùng chung (conversation theo PSID, mapping PSID theo comment, dòng/tab Sheet theo tháng) đều serialize bằng `state/firestore.withLock(key, fn)` — khoá phân tán dựa trên transaction atomic của Firestore. Áp dụng ở: `webhook/facebook.runFlowTurn` (khoá theo PSID — 2 webhook trùng hoặc khách nhắn liên tiếp rất nhanh không được xử lý song song), `webhook/facebook.handleFeedChange` (khoá theo commenterId — 2 comment liên tiếp trước khi PSID kịp phân giải xong; từ mục 5.3, hàm này có thể gọi thẳng `appendLead` khi comment đã có số điện thoại hợp lệ, không chỉ gửi Private Reply), `services/sheetsService.appendLead` (khoá theo tên tab Sheet — 2 lead cùng lúc không được cùng đọc "dòng trống kế tiếp"/"người được gán gần nhất" rồi ghi đè nhau, kể cả khi 1 lead đến từ tin nhắn Messenger và 1 lead khác đến từ comment cùng lúc), `services/sheetsService.copyLeadToFollowUpSheet` (khoá theo tên tab "Hỏi lại" — mục 8c — 2 khách khác nhau cùng hỏi lại gần như đồng thời không được cùng đọc "dòng trống kế tiếp" của tab "Hỏi lại" rồi ghi đè nhau).
- `handleWebhookEvent` phải trả `res.sendStatus(200)` ngay trước khi xử lý nghiệp vụ (tránh Facebook retry trùng lặp) — nên **mọi lỗi phát sinh sau đó phải tự bắt và log nội bộ**, tuyệt đối không được để lỗi thoát ra ngoài rồi gọi `next(err)` ở Express (response đã gửi rồi, gọi `next` lúc này gây crash `ERR_HTTP_HEADERS_SENT`).

---

## 11. Bảo mật & secrets

`.env.example` (không commit file `.env` thật):

```
FB_PAGE_ACCESS_TOKEN=
FB_APP_SECRET=
FB_VERIFY_TOKEN=
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=
GOOGLE_SHEET_ID=
FIRESTORE_PROJECT_ID=
# API key lấy từ Google AI Studio (Gemini Developer API, free tier) — dùng cho lớp trả lời tự do
# bằng AI (mục 4.2). KHÔNG phải Vertex AI, KHÔNG liên quan tới gói thuê bao Google AI Pro/Ultra.
GEMINI_API_KEY=
```

---

## 12. Checklist setup Facebook (thủ tục, không phải code — cần chuẩn bị trước để không chặn tiến độ)

1. Tạo Facebook App tại developers.facebook.com, thêm sản phẩm Messenger, liên kết Page.
2. Tạo webhook HTTPS, verify token, subscribe field: `messages`, `messaging_postbacks`, `feed`.
3. Xin quyền `pages_messaging`, `pages_manage_engagement`, `pages_read_engagement` — cần **App Review** (kèm chính sách bảo mật, video demo) để hoạt động với người dùng thật ngoài vai trò admin/tester trên Page; có thể yêu cầu xác minh doanh nghiệp. Việc này mất từ vài ngày đến vài tuần chờ Meta duyệt — **lên kế hoạch trước, không chờ đến lúc code xong mới nộp**.
4. Trước khi duyệt xong, test toàn bộ luồng với tài khoản có vai trò Admin/Tester trên Page (không cần App Review).

---

## 13. Kế hoạch test

- Dùng Page/App ở chế độ thử nghiệm, 1 Google Sheet nháp trước khi go-live thật.
- `test/fixtures/`: chứa payload mẫu JSON cho các sự kiện webhook Facebook (message, postback, comment) để viết unit test cho `flowEngine` mà không cần Page thật.
- Test round-robin qua ít nhất N+1 lead (N = số người trong dropdown cột F) để xác nhận vòng lặp quay lại đúng người đầu tiên (`pickNextStaff`, mục 9).
- Test round-robin **xuyên tab tháng** (`findLastValidAssignment`, mục 8b/9): tạo lịch sử F ở tab "Tháng 9", ghi lead đầu tiên vào tab "Tháng 10" (F trống) → assert `assignedStaff` là người kế tiếp ngay sau người cuối cùng ở "Tháng 9", không phải `dropdownList[0]`. Test thêm trường hợp tab liền trước cũng chưa có lịch sử/chưa tồn tại → lùi tiếp đúng 1 tab nữa.
- Test số điện thoại: đúng 10 số, 9 số (thiếu), 11 số (thừa), 10 số nhưng sai đầu số, có `+84`, có khoảng trắng/gạch ngang.
- Với **mọi** trường hợp số điện thoại không hợp lệ ở trên: assert rõ ràng rằng `sheetsService.appendLead()` **không hề được gọi** (mock/spy hàm này trong test `flowEngine`) — không chỉ kiểm tra nội dung M6 trả về mà còn phải kiểm tra Sheet không bị tác động.
- Test nhánh "hỏi lại" (mục 5.2/6): state `IN_PROGRESS`, khách nhắn tin tự do không có chuỗi số nào → assert nhận lại đúng M1 → M2 → M3; lặp lại 2-3 lần liên tiếp vẫn phải nhận lại đủ bộ mỗi lần. State `CLOSED`, khách nhắn thêm không có số hoặc số giống hệt số cũ → assert chỉ nhận đúng M7, không gọi `appendLead`, không đổi state (mục 6, AC6).
- Test nhánh CLOSED + số điện thoại (mục 6, AC6/AC15): số **sai định dạng** → assert nhận đúng M6 tương ứng, không gọi `appendLead`/`copyLeadToFollowUpSheet`/`updateLeadPhoneAndCopyToFollowUpSheet`. Số **hợp lệ nhưng khác số cũ** → assert `updateLeadPhoneAndCopyToFollowUpSheet` được gọi đúng 1 lần với `(oldPhone, newPhone)`, `copyLeadToFollowUpSheet` KHÔNG được gọi, hồ sơ Firestore lưu lại đúng `newPhone`. Số **giống hệt số cũ** → assert chỉ gọi `copyLeadToFollowUpSheet`, không gọi hàm sửa số.
- Test tab "Hỏi lại" (mục 8c, `copyLeadToFollowUpSheet` / `updateLeadPhoneAndCopyToFollowUpSheet`): khách CLOSED nhắn lại → assert hàm tương ứng được gọi đúng 1 lần với đúng số điện thoại; assert không gọi khi `conversations.phone` là `null` (chưa từng có lead thật, dữ liệu bất thường). Test riêng hàm tìm dòng theo SĐT: tìm thấy ở tab tháng bất kỳ → trả về đúng tên tab + số dòng + toàn bộ cột A-H; không tìm thấy ở tab tháng nào → throw để lớp gọi ngoài log lỗi thay vì âm thầm bỏ qua. Test `updateLeadPhoneAndCopyToFollowUpSheet` chỉ ghi đè đúng cột B trên tab gốc, các cột còn lại của dòng copy sang "Hỏi lại" giữ nguyên như dữ liệu gốc.
- Test nhánh comment cho số ngay trong comment (mục 5.3, dùng fixture `test/fixtures/commentWithPhone.json`): comment chứa số hợp lệ → assert `appendLead` được gọi đúng 1 lần, không có M1-M3 nào được gửi trước đó, khách nhận M5 qua Private Reply; comment chứa số không hợp lệ → assert M6 qua Private Reply, `appendLead` không được gọi; comment không có số → assert M1 → M2 → M3 như hành vi cũ.
- Test cột C (mục 8): với input `first_name = "A"`, `last_name = "Nguyễn Văn"` → assert giá trị ghi vào cột C là `"Nguyễn Văn A"` (không phải `"A Nguyễn Văn"`).
- Test cột E (mục 8, AC13): số điện thoại hợp lệ đến từ tin nhắn Messenger (`type: 'TEXT'`) → assert `appendLead` được gọi với `source: "Tin nhắn"`; số điện thoại hợp lệ đến từ comment (`type: 'FEED_COMMENT'`, cả nhánh đã map PSID lẫn nhánh comment đầu tiên) → assert `appendLead` được gọi với `source: "Cmt"`. Đồng thời assert lệnh ghi cột E không nằm chung 1 vùng với cột A-C (không được phép đụng cột D xen giữa).
- Test lớp AI trả lời tự do (mục 4.2, AC3/AC8/AC9/AC16):
  - `flowEngine.processInput` (hàm thuần, không cần gọi Gemini thật): free text trên state `NEW` → assert `messagesToSend` đúng `['M1', 'AI_REPLY', 'M3']`; trên state `IN_PROGRESS` không có SĐT → assert đúng `['AI_REPLY', 'M3']`. Nút bấm (`BUTTON`) và nhánh `CLOSED` phải KHÔNG đổi (vẫn `M1→M2→M3`/`M1→M4→M3`/`M7`, không có `'AI_REPLY'`).
  - `geminiService.buildSystemInstruction` (hàm thuần): assert luôn nhúng đúng nội dung `knowledgeBase.ts`; assert không có tham số nào của hàm này chấp nhận/truyền số điện thoại khách vào prompt.
  - `webhook/facebook.ts` (mock `geminiService.generateAiReply`, không gọi API thật): khi `messagesToSend` chứa `'AI_REPLY'` → assert gọi đúng 1 lần `generateAiReply` kèm đúng lịch sử/tên khách, gửi cho khách đúng text trả về (không tra `messages.json` cho mã này); khi `generateAiReply` reject hoặc trả về chuỗi rỗng → assert khách vẫn nhận được 1 tin (fallback đúng nguyên văn M2) và `logError` được gọi.
  - Assert `conversations.aiHistory` sau 1 lượt AI trả lời có thêm đúng 2 phần tử mới (`user` + `model`) và bị cắt còn tối đa 10 phần tử khi vượt ngưỡng.

---

## 14. Giới hạn kỹ thuật đã biết (không phải bug, không cần "sửa cho chạy được")

- Facebook Graph API không trả về địa chỉ/quê quán/tỉnh thành của người dùng Messenger — cột D chỉ có dữ liệu khi khách tự nói ra trong chat và nhân viên tự ghi thêm.
- **Lấy link Facebook cá nhân của khách (cột H) đã bị loại khỏi phạm vi dự án** theo quyết định chủ dự án — không triển khai dưới bất kỳ hình thức nào, kể cả tự động (dựng link từ `from.id` của comment, vốn khả thi hợp lệ) lẫn thủ công (nhân viên copy tay từ hộp thư Page). Lý do liên quan (để tham khảo nếu sau này cân nhắc lại): phương án tự động toàn phần bằng trình duyệt giả lập đăng nhập tài khoản admin là hành vi trái chính sách Facebook, rủi ro khoá cả Page quản trị.
- Hosting free-tier có thể có độ trễ khởi động (cold start) vài chục giây nếu không có traffic — ưu tiên Cloud Run/Cloudflare Workers để giảm thiểu.
- **Retry gửi tin Messenger không idempotent**: nếu 1 lệnh gọi Facebook Send API thực ra đã gửi thành công nhưng phản hồi bị rớt mạng trước khi bot nhận được (timeout/connection reset), `withRetry` sẽ hiểu nhầm là thất bại và gửi lại — khách có thể nhận trùng 1 tin nhắn. Facebook Send API không hỗ trợ idempotency key nên không thể loại bỏ hoàn toàn rủi ro này bằng code; chấp nhận như rủi ro tồn dư (hậu quả nhẹ: khách nhận trùng tin, không mất lead, không trùng dòng Sheet).
- **Giá trị cột F có sẵn (pre-fill) trên tab "Tháng 9" được tin tưởng tuyệt đối, không đối chiếu lại dropdown hiện tại**: nếu dòng vừa ghi lead trên tab "Tháng 9" đã có sẵn giá trị F (dữ liệu thật do nhân viên pre-fill từ trước khi có bot — mục 8b), bot dùng luôn giá trị đó làm `assignedStaff`, kể cả khi người đó đã bị xoá khỏi dropdown hiện tại (vd nhân viên nghỉ việc nhưng dữ liệu mẫu chưa cập nhật). Đây là đánh đổi có chủ đích để tôn trọng đúng yêu cầu "không đụng cột F đã có" trên tab gốc — nếu muốn bot tự sửa các ô F pre-fill không còn hợp lệ, cần yêu cầu riêng. Các tab tháng sau do bot tự tạo (mục 8b) không còn pre-fill F nữa nên không gặp trường hợp này.
- **Round-robin nối tiếp xuyên tháng qua `findLastValidAssignment` đệ quy lùi tab** (mục 9): khi sang tab tháng mới (cột F trống hoàn toàn từ dòng 2 — mục 8b), lead đầu tiên của tháng đó tự động lùi sang tab tháng liền trước (và xa hơn nữa nếu tab đó cũng chưa có lịch sử hợp lệ, hoặc chưa từng được tạo) để tìm người được gán gần nhất, nên thứ tự luân phiên không bị "reset" giữa các tháng. Giới hạn còn lại: việc lùi tab chỉ dựa vào số thứ tự tháng suy ra tên tab ("Tháng 10" → "Tháng 9" → dừng), không hiểu các tên tab đặt khác quy ước — nếu ai đó đổi tên tab thủ công sai định dạng "Tháng {N}", chuỗi lùi tab sẽ đứt và thuật toán coi như không có lịch sử trước đó.
- **Chi phí AI (Gemini) & lựa chọn nền tảng (mục 4.2, tối giản chi phí)**: dùng **Gemini Developer API qua Google AI Studio** (API key riêng), model **`gemini-3.5-flash`**, chạy trong hạn mức **free tier** — đủ dùng cho quy mô 1 fanpage, không cần bật billing. Cố tình **không dùng Vertex AI** vì nền tảng đó không có free tier thường trực (chỉ có credit dùng thử $300/90 ngày của tài khoản Google Cloud trial, hết hạn/hết credit là phải trả phí đầy đủ). Gói thuê bao **Google AI Pro/Ultra (Google One) không cộng dồn quota vào lời gọi API backend** — quota gói đó chỉ áp dụng trong giao diện AI Studio (Playground/Build), nên chỉ hữu ích để thử prompt trước khi đưa vào code, không thay thế được API key production. Dòng model Gemini 2.5 (Flash/Flash-Lite) sẽ ngừng hoạt động **16/10/2026** — cố tình chọn thẳng `gemini-3.5-flash` (không phải 2.5) để tránh phải migrate lại chỉ vài tuần sau khi go-live.
- **Rủi ro hallucination của AI được giảm thiểu bằng 2 lớp cố định trong code, không phụ thuộc AI "tự giác"** (mục 4.2): (1) system instruction ép buộc chỉ dùng dữ kiện trong `knowledgeBase.ts`, cấm bịa thêm giá/pháp lý/cam kết ngoài file đó; (2) hành động xin số Zalo (M3) luôn do code tự thêm cứng ngay sau câu trả lời AI, bất kể AI có tự nhắc hay không — đảm bảo mục tiêu chốt lead của dự án không bị ảnh hưởng dù chất lượng câu trả lời AI dao động.
- **Free tier Gemini và quyền riêng tư dữ liệu**: theo điều khoản hiện tại của Google, dữ liệu gửi qua free tier của Gemini Developer API có thể được dùng để cải thiện model (có thể có người review). Vì vậy nhánh AI (mục 4.2) **tuyệt đối không được gửi số điện thoại thật của khách** vào prompt/lịch sử — điều này đã tự động được đảm bảo do AI chỉ được gọi khi `phoneValidator` xác nhận tin nhắn không có chuỗi số ứng viên nào (mục 5.2/5.3). Nếu sau này cần xử lý dữ liệu nhạy cảm hơn ở quy mô lớn, cân nhắc chuyển sang Vertex AI (có DPA, không chia sẻ dữ liệu) như một thay đổi hạ tầng riêng, không phải sửa nhỏ.

---

## 15. Thứ tự triển khai cho Claude Code (tuần tự — tránh nhiều phiên sửa chồng nhau)

Thực hiện lần lượt, mỗi bước commit riêng, có test trước khi qua bước kế tiếp. Nếu chạy nhiều phiên Claude Code song song, chỉ giao mỗi phiên đúng 1 bước/1 thư mục, không giao 2 phiên cùng sửa `flowEngine.ts`:

1. Khởi tạo project (Node + TS + Express), `.env.example`, cấu hình lint/build.
2. `config/messages.json` (mục 4) + hàm load config + test.
3. `webhook/facebook.ts`: verify GET, nhận POST, kiểm tra chữ ký `X-Hub-Signature-256` + test với fixture mẫu.
4. `flow/phoneValidator.ts` (mục 7) + test đầy đủ case ở mục 13.
5. `flow/flowEngine.ts` (mục 5, 6) chạy trên state giả lập trong bộ nhớ, test bằng Jest từng nhánh ở bảng mục 5.2.
6. Nối `flowEngine` với Firestore thật (mục 6) thay cho bộ nhớ tạm.
7. `services/sheetsService.ts` (mục 8, 8b) — test ghi vào sheet nháp, test tự tạo tab tháng mới.
8. Round-robin qua dropdown cột F trong `sheetsService.ts` (mục 9) — test `pickNextStaff` + wraparound.
9. Nối toàn bộ end-to-end trong `webhook/facebook.ts` cho luồng Messenger.
10. Thêm nhánh xử lý `feed` (comment) tái sử dụng `flowEngine` (mục 5.3).
11. Rà lại toàn bộ xử lý lỗi/logging (mục 10).
12. Deploy lên Cloud Run/Workers, test với Page ở vai trò Tester.
13. Go-live sau khi App Review được duyệt (mục 12).

---

## 16. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC1**: Bấm "Ở đâu?" hoặc "Giá bao nhiêu?" → nhận đúng M1 → M2 → M3, mỗi tin cách nhau ≥ 2 giây.
- **AC2**: Bấm "Có sổ đỏ không?" → nhận đúng M1 → M4 → M3.
- **AC3**: Nhắn tin tự do khi chưa từng tương tác → nhận M1, sau đó 1 câu trả lời do AI sinh ra bám sát đúng câu hỏi của khách (dựa trên `knowledgeBase.ts`, mục 4.2 — vd hỏi sổ đỏ thì được trả lời đúng trọng tâm pháp lý, không còn luôn nhận cứng M2 về giá như trước), rồi M3 xin số Zalo.
- **AC4**: Gửi số điện thoại được xác nhận **chính xác hợp lệ** qua tin nhắn Messenger (đúng độ dài + đúng đầu số) → Sheet có dòng mới đúng cột A, B, C, F và cột E = `"Tin nhắn"` (cột D thêm nếu nhân viên có ghi tay; cột G để trống; cột H luôn để trống, không xử lý) → khách nhận M5.
- **AC5**: Gửi số điện thoại **không hợp lệ** ở bất kỳ dạng nào (9 số/thiếu, 11 số/thừa, hoặc đúng 10 số nhưng sai đầu số) → nhận đúng M6 tương ứng, và Sheet **tuyệt đối không** có dòng mới, không ô nào bị ghi/sửa/xoá — kiểm tra cả 3 trường hợp, không chỉ thiếu/thừa.
- **AC6**: Sau khi đã chốt lead (state = `CLOSED`):
  - Khách nhắn thêm nội dung không có số hợp lệ khác (không có số, hoặc số giống hệt số cũ) → bot **chỉ trả lời đúng 1 tin M7**, không gửi lại M1-M5, không tạo lead mới trên tab tháng, không đổi state — dòng lead cũ (tra theo số điện thoại đã ghi) được copy nguyên trạng sang tab "Hỏi lại" (mục 8c).
  - Khách gửi số điện thoại **sai định dạng** → nhận đúng M6 tương ứng, tuyệt đối không đụng Sheet (kể cả tab "Hỏi lại").
  - Khách gửi số điện thoại **hợp lệ nhưng khác số cũ** → coi là sửa số: cột B của dòng lead cũ trên tab tháng gốc được cập nhật thành số mới, dòng đã sửa được copy sang tab "Hỏi lại", khách nhận M7 (mục 6, 8c, AC14).
- **AC7**: Gửi N+1 lead hợp lệ liên tiếp (N = số nhân viên) → người thứ N+1 trùng với người thứ 1.
- **AC8**: Comment dưới bài Page **không chứa số điện thoại** → nhận Private Reply đúng M1 → (AI trả lời câu hỏi trong comment, mục 4.2) → M3 đúng 1 lần duy nhất, chuyển state `IN_PROGRESS`. Nếu người này sau đó nhắn lại / hỏi lại mà vẫn chưa cho số (dù nhắn tin trực tiếp hay comment thêm) → nhận AI trả lời câu hỏi mới rồi thêm M3 xin số zalo (AC9); chỉ khi đã cho số hợp lệ (state `CLOSED`) thì các lần hỏi lại tiếp theo mới chuyển sang chỉ nhận M7 cố định, không gọi AI (AC6).
- **AC9**: State `IN_PROGRESS` (đã nhắn cho khách 1 lần rồi), khách nhắn thêm dòng thứ 2 trở đi hoặc nhắn lại mà không kèm số điện thoại → nhận **AI trả lời đúng câu hỏi mới** (mục 4.2) rồi thêm M3 xin số zalo (không lặp lại M1 hay M2 cứng); mỗi lần nhắn thêm tiếp theo mà vẫn chưa có số hợp lệ đều lặp lại đúng cặp (AI trả lời → M3).
- **AC10**: Comment dưới bài Page **có sẵn số điện thoại hợp lệ ngay trong nội dung comment** → Sheet có dòng mới đúng cột A, B, C, F (không cần khách nhắn tin riêng, không có bước M1-M3 nào được gửi trước) nhưng cột E = `"Cmt"` (khác AC4 vì nguồn khác), khách nhận M5 qua Private Reply.
- **AC11**: Lead đầu tiên ghi vào tab tháng mới (cột F còn trống) → được gán đúng người kế tiếp ngay sau người cuối cùng được gán hợp lệ ở tab tháng liền trước, không quay lại đầu danh sách dropdown.
- **AC12**: Tên khách ghi vào cột C đúng thứ tự Việt Nam (Họ + tên đệm + tên gọi), không bị đảo ngược theo thứ tự `first_name`+`last_name` kiểu phương Tây.
- **AC13**: Cột E (Nguồn khách) được bot tự động điền đúng theo kênh phát sinh số điện thoại — `"Tin nhắn"` khi chốt lead từ tin nhắn Messenger (AC4), `"Cmt"` khi chốt lead từ comment (AC10) — và cột D vẫn hoàn toàn không bị đụng tới trong cả 2 trường hợp.
- **AC14**: Khách đã `CLOSED` nhắn lại, không có số điện thoại khác → dòng lead cũ của khách (tra đúng theo số điện thoại đã ghi trên hồ sơ) được copy nguyên vẹn cột A-H sang tab "Hỏi lại", vào đúng dòng trống tiếp theo (bỏ qua các dòng đã có dữ liệu); tab tháng gốc chứa lead đó không bị chỉnh sửa gì. Khách hỏi lại nhiều lần **cách nhau trên 30 phút** → mỗi lần tạo thêm 1 dòng mới trên tab "Hỏi lại"; hỏi lại nhiều lần **trong vòng 30 phút kể từ lần ghi gần nhất** → chỉ dòng đầu tiên được ghi, các lần sau trong cùng cửa sổ 30 phút bị bỏ qua, không tạo thêm dòng (mục 8c, debounce mới).
- **AC15**: Khách đã `CLOSED` gửi lại 1 số điện thoại **hợp lệ nhưng khác** số đã ghi → cột B của đúng dòng lead cũ trên tab tháng gốc được sửa thành số mới (các cột khác của dòng đó giữ nguyên), dòng **đã sửa** (không phải bản gốc) được copy sang tab "Hỏi lại", hồ sơ Firestore của khách cũng cập nhật sang số mới để lần hỏi lại tiếp theo tra cứu đúng (mục 6, 8c).
- **AC16**: Khi gọi Gemini API lỗi/timeout (đã hết số lần retry của `withRetry`, mục 10) hoặc trả về chuỗi rỗng → bot vẫn gửi cho khách đúng 1 câu trả lời dự phòng (nguyên văn M2) thay vì im lặng hoặc bỏ lượt, đồng thời `logError` được ghi lại để theo dõi tần suất fallback (mục 4.2, 10).
