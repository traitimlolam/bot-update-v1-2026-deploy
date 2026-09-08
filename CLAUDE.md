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
    messages.json        # chỉ còn `aiFallbackText` (câu dự phòng khi AI lỗi) + `buttons`, xem mục 4
    knowledgeBase.ts        # dữ kiện BĐS duy nhất AI được phép dùng khi trả lời — mục 4.2
  ai/
    geminiService.ts        # gọi 9Router (OpenAI-compatible) sinh TOÀN BỘ câu trả lời hội thoại — mục 4.2
  webhook/
    facebook.ts            # nhận & xác thực webhook Facebook (messages, postbacks, feed/comment); comment cũng được quét số điện thoại trước khi quyết định chốt lead hay gọi AI trả lời — mục 5.3
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

## 4. Nội dung trả lời khách (cập nhật quyết định — chủ dự án đã duyệt, xem mục 4.2)

**Không còn "danh mục tin nhắn" (Message Catalog) M1-M7 cố định.** Trước đây flow tra 1 trong các mã M1-M7 để lấy nguyên văn câu trả lời từ `config/messages.json`; nay **AI (qua `ai/geminiService.ts`) tự viết TOÀN BỘ câu chữ** cho mọi tình huống hội thoại — kể cả câu lịch sự mời khách để lại số Zalo/điện thoại (trước đây là M3 cố định, xem mục 4.2). `config/messages.json` giờ chỉ còn đúng 1 khoá:

| Khoá | Nội dung | Khi nào hiện ra |
|----|----------|----|
| `aiFallbackText` | Hiện tại bên em đang có nhiều lô đất giá rẻ... Anh/chị nhắn em số zalo nhé, em gửi vị trí, ảnh mặt bằng và bảng giá chi tiết anh/chị tham khảo ạ. | **CHỈ** khi Gemini lỗi/timeout hoặc trả về rỗng (đã hết retry) — câu trả lời dự phòng DUY NHẤT còn lại trong hệ thống, xem mục 4.2 "Fallback bắt buộc". Không phải 1 bước bình thường của kịch bản. |

Quy tắc gửi: mỗi tin là **một tin nhắn Messenger riêng biệt**, kèm hiệu ứng "đang nhập..." (sender action `typing_on`) trước mỗi tin để tự nhiên hơn; nếu 1 lượt gửi nhiều tin liên tiếp, cách nhau tối thiểu 2 giây.

### 4.1 Cá nhân hoá đại từ xưng hô theo giới tính khách hàng (`src/utils/genderDetector.ts`)

Áp dụng cho lời chào mở đầu không qua AI (`buildNaturalGreeting`/`buildCommentGreeting`, mục 4.2) và cho `aiFallbackText` khi cần dùng tới. Với văn bản do AI tự viết (đa số các trường hợp), quy tắc xưng hô này được truyền vào **system instruction** của Gemini (`buildSystemInstruction`, mục 4.2) để AI tự áp dụng khi viết câu, không dùng `formatPersonalizedMessage` (hàm đó chỉ thay thế đúng chuỗi mẫu cố định "Anh/chị", không có tác dụng với câu AI tự do viết). Bot tự động phân tích tên Facebook của khách hàng để chọn danh xưng tự nhiên và chuyên nghiệp nhất:

1. **Phân tích giới tính (`analyzeVietnameseName`)**:
   - **Nữ (`FEMALE`)**: Tên đệm chứa chữ "Thị" (100% Nữ) hoặc tên chính thuộc từ điển tên nữ phổ biến (*Hương, Hằng, Lan, Mai, Trang, Thảo, Linh, Hoa, Nga, Tuyết, Loan, Yến, Nhung, Hạnh, Thủy, Ngân, Ly, Huyền, Trâm, Phương, Trinh, Quỳnh, Hiền, My, Chi, Vân, Thư, Đào, Khiêm...*).
   - **Nam (`MALE`)**: Tên đệm nam đặc trưng (*Văn, Đình, Hữu, Đức, Công, Bá, Trọng, Quang, Viết, Đăng, Khắc, Thế, Quốc...*) hoặc tên chính thuộc từ điển tên nam phổ biến (*Cường, Hiếu, Tuấn, Hùng, Thắng, Nam, Long, Quân, Huy, Phong, Hải, Hoàng, Tùng, Sơn, San, Thành, Đạt, Trung, Kiên, Phúc, Thiệu, Minh, Việt, Nghĩa, Khang, Khoa, Vũ, Tiến, Toàn, Lâm, Chiến, Thịnh...*).
   - Hỗ trợ chuẩn hoá chữ không dấu và xử lý tên đảo thứ tự (như "Bay Nguyen", "Lan Nguyen").

2. **Quy tắc thay thế đại từ (`formatPersonalizedMessage`)**:
   - **Khách là Nam**: Thay `Anh/chị`, `Anh/Chị` → `Anh`; thay `anh/chị`, `anh chị` → `anh`.
   - **Khách là Nữ**: Thay `Anh/chị`, `Anh/Chị` → `Chị`; thay `anh/chị`, `anh chị` → `chị`.
   - **Không xác định được Nam hay Nữ**: Bỏ trống danh xưng Anh/Chị, **điền đầy đủ cả họ tên của khách vào câu** (ví dụ: *"Em chào Bay Nguyen."*, *"Bay Nguyen nhắn em số zalo nhé."*, *"Bay Nguyen chờ một chút, nhân viên tư vấn của bên em sẽ liên hệ với Bay Nguyen ngay đây ạ."*).
   - **Không có tên (null / rỗng)**: Giữ nguyên câu mẫu mặc định (`"Anh/chị"`, `"anh/chị"`).

### 4.2 AI (Gemini) viết toàn bộ câu trả lời hội thoại (cập nhật quyết định — chủ dự án đã duyệt)

**Quyết định mới nhất**: trước đây chỉ nhánh "khách hỏi tự do ngoài 3 chủ đề nút bấm" mới dùng AI (các nhánh còn lại vẫn trả lời bằng message code M1-M7 cố định). Chủ dự án đã yêu cầu bỏ HẲN mọi kịch bản trả lời cố định (kể cả câu trả lời khi bấm nút, câu xác nhận đã nhận số, câu báo sai số điện thoại, câu trấn an khách đã CLOSED, và câu mời để lại số Zalo) — **AI viết TOÀN BỘ câu chữ cho mọi tình huống**, chỉ trừ đúng 1 trường hợp dự phòng khi AI lỗi (xem "Fallback bắt buộc" bên dưới). Việc chốt lead, ghi Sheet, round-robin, ẩn comment, `phoneValidator`, reminder 20h **không đổi gì** — mục này chỉ thay lớp CÂU CHỮ hiển thị cho khách.

**5 loại sự kiện (`ReplyIntent`, `flow/flowEngine.ts`) — AI được gọi cho CẢ 5 loại**:
| Sự kiện | Khi nào xảy ra | AI có được mời xin số Zalo không? |
|---|---|---|
| `AI_TOPIC` | Khách bấm 1 trong 3 nút (`BTN_LOCATION`/`BTN_LEGAL`/`BTN_PRICE`) | **Có, bắt buộc** — kết thúc câu trả lời bằng 1 câu lịch sự mời để lại số |
| `AI_FREE_TEXT` | Khách nhắn/bình luận tự do, không có chuỗi số điện thoại nào trong tin (mục 7 điểm 5), dù là lần đầu (`NEW`) hay hỏi thêm (`IN_PROGRESS`) | **Có, bắt buộc** |
| `AI_PHONE_CONFIRMED` | Khách vừa để lại số điện thoại **hợp lệ** (chốt lead) | **Không** — đã có số rồi, không hỏi lại |
| `AI_PHONE_INVALID` | Khách gửi số điện thoại **sai định dạng** (thiếu/thừa/sai đầu số) | Không mời kiểu mới, nhưng được yêu cầu gửi lại đúng số (ngoại lệ duy nhất được nhắc tới số điện thoại) |
| `AI_FOLLOWUP_CLOSED` | Khách đã `CLOSED` (đã bàn giao nhân viên) nhắn/bình luận thêm | **Không** — đã bàn giao rồi, không hỏi thêm |

`flowEngine.processInput` (vẫn là hàm thuần, không gọi API — mục 3) chỉ trả về DANH SÁCH `ReplyIntent` mô tả SỰ KIỆN gì vừa xảy ra (`messagesToSend: ReplyIntent[]`), không tự quyết định câu chữ. Lớp gọi ngoài (`webhook/facebook.ts`) gọi sang `geminiService.generateAiReply(...)` cho từng `ReplyIntent`, truyền kèm `isNewCustomer` (chỉ true khi `AI_TOPIC`/`AI_FREE_TEXT` và đây là lượt đầu tiên, để AI biết có cần chào mở đầu hay không).

**Có chuỗi số ứng viên trong tin** (hợp lệ hoặc không hợp lệ) vẫn luôn do `phoneValidator` quyết định trước — AI chỉ vào cuộc SAU khi đã biết kết quả (để viết đúng câu xác nhận/báo lỗi tương ứng), không tự phán đoán số điện thoại.

**Nền tảng & lựa chọn model (cập nhật quyết định — chủ dự án đã duyệt, xem thêm mục 14)**: gọi qua **"9Router"** — một proxy tự host của chủ dự án, expose theo chuẩn OpenAI-compatible (`POST {AI_ROUTER_URL}/chat/completions`), kết nối qua mạng riêng **Tailscale** (mặc định `http://100.93.163.100:20128/v1`, model alias `ag/gemini-3.8-flash-high`, có thể ghi đè qua biến môi trường `AI_ROUTER_URL`/`AI_MODEL_NAME`). Router này **xoay vòng nhiều tài khoản Google AI Pro/Ultra (Google One)** cá nhân của chủ dự án để gọi model Gemini bên dưới, giúp có hạn mức hàng nghìn lượt/ngày thay vì bị chặn ở mức ~20 lượt/ngày của Gemini Developer API free tier thông thường. Đây là thay đổi có chủ đích so với thiết kế ban đầu (vốn cấm dùng quota Pro/Ultra cho backend, xem mục 14) — chủ dự án đã cân nhắc và duyệt đánh đổi này để đủ hạn mức vận hành thật, chấp nhận rủi ro vận hành đi kèm (uptime/độ trễ phụ thuộc vào router tự host và mạng Tailscale, xem mục 14). Request gửi lên router **không kèm theo API key/Authorization header** — router tự quản lý việc xác thực với các tài khoản Google đã xoay vòng ở phía nó, code chỉ gọi thẳng endpoint chat-completions.

**`src/config/knowledgeBase.ts`**: nguồn dữ kiện **DUY NHẤT** AI được phép dùng để trả lời (vị trí, giá, pháp lý, tiện ích, chính sách thanh toán...). System instruction gửi cho Gemini phải nêu rõ: chỉ được trả lời dựa trên nội dung file này, **tuyệt đối không tự bịa thêm dữ kiện** (giá, pháp lý, cam kết) ngoài những gì có trong file. File này cũng là nơi duy nhất khai báo **số Zalo/điện thoại liên hệ của bên em** (`0916.060.254`) để AI cung cấp khi khách chủ động hỏi xin số liên hệ của bên em (khác với việc bot xin số của khách) — sửa số này ở đây nếu cần đổi, không hard-code rải rác nơi khác.

**`src/ai/geminiService.ts`** (lớp mỏng gọi API bên ngoài — chỉ test thủ công phần gọi API thật, xem mục 3):
- Export `buildSystemInstruction(customerName)`: hàm thuần lắp ráp system prompt CHUNG cho mọi sự kiện (knowledge base + quy tắc xưng hô theo mục 4.1 + quy tắc không bịa + phương châm ngắn gọn/lịch sự/gây tò mò) — arity 1 (chỉ nhận `customerName`), không có tham số nào cho phép truyền số điện thoại khách vào prompt (mục 13).
- Export `describeIntent(intent, userText, isNewCustomer)`: hàm thuần dịch 1 `ReplyIntent` (mục 4.2 bảng trên) thành hướng dẫn CỤ THỂ cho lượt hiện tại — bao gồm CÓ cần mời để lại số Zalo hay không, có cần chào mở đầu hay không — ghép vào tin nhắn "user" cuối cùng gửi cho model (không đưa vào system instruction, giữ `buildSystemInstruction` thuần/chung).
- Export `generateAiReply({ intent, userText, history, customerName, isNewCustomer })`: gọi model thật (bọc `withRetry`, mục 10) với system instruction + lịch sử + `describeIntent(...)`.

**Bắt buộc — Fallback khi Gemini lỗi (AC16)**: nếu lời gọi `generateAiReply` thất bại (đã qua hết số lần retry của `withRetry`, mục 10) hoặc trả về chuỗi rỗng, bot **không được im lặng** — dùng lại nguyên văn `aiFallbackText` (`messages.json`, mục 4) làm câu trả lời thay thế, đồng thời `logError` (mục 10) để theo dõi tần suất fallback. Đây là NGOẠI LỆ DUY NHẤT còn sót lại 1 câu trả lời cố định trong toàn hệ thống — chấp nhận đánh đổi (câu trả lời không linh hoạt bằng AI) để đổi lấy nguyên tắc quan trọng hơn: khách không bao giờ bị bot im lặng hoàn toàn.

**Lịch sử hội thoại cho AI**: lưu tại `conversations.aiHistory` trong Firestore (mảng `{ role: 'user' | 'model', text: string }`, chỉ giữ tối đa 10 phần tử gần nhất ≈ 5 lượt qua lại, phần tử cũ hơn bị cắt bỏ khi ghi thêm) để AI trả lời có ngữ cảnh mà không tốn token vô hạn. Chỉ lưu lịch sử cho 2 sự kiện `AI_TOPIC`/`AI_FREE_TEXT` — trường này **không bao giờ chứa số điện thoại thật của khách**: 3 sự kiện còn lại (`AI_PHONE_CONFIRMED`/`AI_PHONE_INVALID`/`AI_FOLLOWUP_CLOSED`) luôn phát sinh đúng lúc tin nhắn CÓ thể chứa số điện thoại thật, nên cố tình không lưu vào lịch sử dù vẫn gọi AI cho các sự kiện đó.

**Cách flowEngine.ts (vẫn là hàm thuần, không gọi API — mục 3) phối hợp với AI**: `processInput` không tự gọi Gemini — chỉ trả về `messagesToSend: ReplyIntent[]` (mục 4.2 bảng trên) mô tả SỰ KIỆN gì vừa xảy ra. Chỉ lớp gọi ngoài (`webhook/facebook.ts`) hiểu từng `ReplyIntent` là tín hiệu để gọi sang `geminiService.generateAiReply(...)` — giữ đúng ranh giới "flowEngine thuần, không gọi API bên ngoài" đã quy định từ đầu dự án.

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
| Bấm `BTN_LOCATION` / `BTN_PRICE` / `BTN_LEGAL` | — | 1 tin `AI_TOPIC` (AI tự viết, dựa trên `knowledgeBase.ts`, kèm lời mời để lại số Zalo — mục 4.2) |
| Nhắn tin tự do (không phải bấm nút, không chứa số điện thoại) | conversation state = `NEW` (chưa từng chạy luồng) | 1 tin `AI_FREE_TEXT` (AI tự viết, chào mở đầu + trả lời đúng câu hỏi + mời để lại số Zalo — mục 4.2) |
| Nhắn tin tự do, quét không thấy chuỗi số ứng viên nào trong tin (kể cả sau đó sẽ không hợp lệ) | conversation state = `IN_PROGRESS` (đã từng trả lời nhưng chưa có số hợp lệ) | Khách **"nhắn thêm dòng thứ 2" / "hỏi lại"**: 1 tin `AI_FREE_TEXT` (không chào lại, trả lời đúng câu hỏi mới + mời để lại số Zalo), cập nhật `lastFlowSentAt`. Mỗi tin tự do tiếp theo mà vẫn chưa có số hợp lệ đều lặp lại đúng cách này |
| Nhắn tin tự do, KHÔNG có số điện thoại hoặc có số điện thoại **giống hệt** số đã ghi | conversation state = `CLOSED` (xem mục 6) | 1 tin `AI_FOLLOWUP_CLOSED` (AI trấn an, không hỏi lại số), không tạo lead mới, không đổi số — copy nguyên trạng dòng lead cũ sang tab "Hỏi lại" (mục 6, 8c) |
| Nhắn tin tự do có số điện thoại **hợp lệ nhưng KHÁC** số đã ghi | conversation state = `CLOSED` (xem mục 6) | Coi là khách **sửa số**: sửa lại cột B của dòng lead cũ trên tab tháng gốc + cập nhật hồ sơ Firestore, rồi copy dòng đã sửa sang tab "Hỏi lại" (mục 8c), trả lời 1 tin `AI_FOLLOWUP_CLOSED` |
| Nhắn tin tự do có chuỗi số nhưng **sai định dạng** (thiếu/thừa/sai đầu số) | conversation state = `CLOSED` (xem mục 6) | 1 tin `AI_PHONE_INVALID` (AI viết đúng theo loại lỗi) — **tuyệt đối không đụng Sheet** ở nhánh này (kể cả tab "Hỏi lại"), giống hệt nguyên tắc áp dụng khi chưa `CLOSED` |
| Tin nhắn chứa số điện thoại **được `phoneValidator` xác nhận CHÍNH XÁC hợp lệ** (đúng cả độ dài lẫn đầu số) | state ≠ `CLOSED` | Chỉ khi đến bước này mới được phép tác động vào Sheet: chạy luồng chốt lead — ghi Sheet (mục 8) → phân bổ NV vào cột F (mục 9) → trả lời khách 1 tin `AI_PHONE_CONFIRMED` → set state = `CLOSED` |
| Tin nhắn chứa số điện thoại **không hợp lệ** — thiếu số, thừa số, hoặc đúng 10 số nhưng sai đầu số | state ≠ `CLOSED` | 1 tin `AI_PHONE_INVALID` (AI viết đúng theo loại lỗi "thiếu" / "thừa" / "chưa đúng định dạng"). **Tuyệt đối không ghi, sửa, hay xoá bất kỳ ô/cột nào trong Sheet** ở nhánh này. State giữ nguyên |

Thứ tự đánh giá trên 1 tin nhắn tự do (tránh chồng chéo giữa các nhánh trên): (1) `CLOSED` luôn được kiểm tra ĐẦU TIÊN — nhưng vẫn quét số điện thoại trong tin để phân biệt 3 nhánh CLOSED phía trên (sai định dạng / số khác cũ / số giống cũ hoặc không có số), không còn "bỏ qua nội dung" như thiết kế trước; (2) nếu chưa `CLOSED`, quét chuỗi số liên tiếp ≥ 8 ký tự (mục 7, điểm 5) — nếu có, ưu tiên xử lý theo 2 nhánh "số điện thoại hợp lệ/không hợp lệ" phía dưới; (3) chỉ khi không có chuỗi số ứng viên nào mới xét tới state còn lại (`NEW`/`IN_PROGRESS` → `AI_FREE_TEXT`, mục 4.2).

**Lưu ý triển khai**: nhánh "chốt lead khi có số điện thoại hợp lệ" (`processInput` trong `flowEngine.ts`) và nhánh chốt lead ngay từ comment đầu tiên (`handleFirstCommentWithValidPhone` trong `webhook/facebook.ts`, mục 5.3) là 2 điểm vào khác nhau do đặc thù kỹ thuật của Private Reply API (chưa biết PSID trước khi gửi) — cả 2 đều gọi chung `sheetsService.appendLead` (mục 8) làm điểm ghi Sheet DUY NHẤT, tránh cài trùng logic ghi Sheet/round-robin ở nhiều nơi dù không dùng chung 1 hàm chốt lead cấp cao.

### 5.3 Luồng comment trên Page (R2)

Khi có comment mới dưới bài đăng của Page (webhook field `feed`): trước tiên áp dụng **cùng `phoneValidator`** lên nội dung comment (cùng ngưỡng "chuỗi số liên tiếp ≥ 8 ký tự" ở mục 7, điểm 5) để quét xem khách có để lại số điện thoại ngay trong comment hay không, rồi mới quyết định nhánh xử lý:

| Kết quả quét comment | Xử lý |
|---|---|
| Có chuỗi số ứng viên, `phoneValidator` trả `valid === true` | **Chốt lead ngay từ comment**, không cần chờ khách nhắn tin riêng: ghi Sheet (mục 8, cột C lấy theo tên hiển thị `from.name` của comment) → phân bổ NV cột F (mục 9) → gửi **Private Reply** 1 tin `AI_PHONE_CONFIRMED` → set state = `CLOSED` cho PSID tương ứng. Không gửi câu trả lời/mời để lại số nào trước đó |
| Có chuỗi số ứng viên nhưng `phoneValidator` trả `valid === false` (thiếu/thừa/sai đầu số) | Gửi **Private Reply** 1 tin `AI_PHONE_INVALID`, **không tác động Sheet** — giữ đúng nguyên tắc mục 7 điểm 6 |
| Không có chuỗi số ứng viên nào trong comment | Gửi 1 lời chào ngắn KHÔNG qua AI (`buildCommentGreeting`, tiết kiệm chi phí) làm tin PROBE để Facebook trả về PSID thật, rồi giao cho đúng luồng dùng chung với mục 5.2 theo state PSID (nếu `NEW`/chưa từng có hội thoại hoặc `IN_PROGRESS` → 1 tin `AI_FREE_TEXT`; nếu đã `CLOSED` → 1 tin `AI_FOLLOWUP_CLOSED`) |

Trong cả 3 trường hợp, sau khi PSID được phân giải từ comment, mọi tương tác tiếp theo của khách (chat trực tiếp hoặc comment thêm) đều dùng chung state theo PSID như mục 5.2/6: nếu vẫn ở `IN_PROGRESS` (chưa cho số) và khách hỏi lại / nhắn lại — bất kể qua kênh nào (nhắn tin vào Page hay comment thêm) — 1 tin `AI_FREE_TEXT` (mục 4.2); nếu đã `CLOSED` (đã có số điện thoại hợp lệ), khách hỏi lại qua bất kỳ kênh nào cũng chỉ nhận 1 tin `AI_FOLLOWUP_CLOSED` và không tạo lead mới (mục 6) — không còn tuyệt đối im lặng, nhưng cũng không xử lý lại như một lượt hỏi mới.

`conversations.lastCommentId` (mục 5.4/8c mở rộng): mỗi lượt xử lý (`runFlowTurn`) ghi lại `comment_id` nếu lượt đó đến từ 1 bình luận, hoặc xoá về `null` nếu đến từ nhắn tin trực tiếp (đã tự chứng minh gửi tin thường theo `{id: psid}` hoạt động được) — dùng để `services/reminderService.ts` (mục 5.4) chọn đúng kiểu recipient khi gửi tin nhắc 20h cho nhóm khách chỉ mới bình luận.

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

- `NEW`: chưa từng nhận câu trả lời nào.
- `IN_PROGRESS`: đã từng trả lời (bấm nút hoặc AI_FREE_TEXT), chưa có số điện thoại hợp lệ.
- `CLOSED`: đã có số điện thoại hợp lệ và đã gán nhân viên phụ trách (ghi cột F) — bàn giao cho nhân viên xử lý tiếp (kênh báo cho nhân viên nằm ngoài phạm vi bản này). **Từ thời điểm này bot không còn tạo lead mới trên tab tháng nữa**, nhưng KHÔNG im lặng tuyệt đối như bản cũ — khách nhắn tiếp bất kỳ nội dung gì được xử lý theo 3 nhánh (xem AC6):
  - Tin nhắn có chuỗi số nhưng **sai định dạng** (thiếu/thừa/sai đầu số, mục 7) → trả lời 1 tin `AI_PHONE_INVALID` (mục 7 điểm 6: tuyệt đối không đụng Sheet ở nhánh này, kể cả tab "Hỏi lại"), state và số điện thoại giữ nguyên.
  - Tin nhắn có số điện thoại **hợp lệ nhưng KHÁC** số đã ghi trước đó → coi là khách **sửa số**: cập nhật `phone` trên hồ sơ Firestore của khách **và** sửa lại cột B của dòng lead cũ trên tab tháng gốc, rồi copy dòng đã sửa sang tab "Hỏi lại" (mục 8c), trả lời 1 tin `AI_FOLLOWUP_CLOSED`.
  - Mọi trường hợp còn lại (không có số, hoặc số hợp lệ giống hệt số cũ) → giữ nguyên số/state, copy nguyên trạng dòng lead cũ sang tab "Hỏi lại" (mục 8c), trả lời 1 tin `AI_FOLLOWUP_CLOSED` (AI viết, trấn an khách đã có nhân viên phụ trách).
- Khi state = `IN_PROGRESS` và khách nhắn tiếp một tin không chứa chuỗi số ứng viên nào (mục 7, điểm 5): coi là khách **"hỏi lại"** — 1 tin `AI_FREE_TEXT` (AI trả lời đúng câu hỏi mới dựa trên `knowledgeBase.ts` + mời để lại số Zalo trong CÙNG 1 câu, mục 4.2), cập nhật `lastFlowSentAt`. Hành vi này lặp lại không giới hạn số lần cho tới khi khách gửi số điện thoại hợp lệ (state chuyển `CLOSED`) hoặc không hợp lệ (trả lời `AI_PHONE_INVALID`, state giữ `IN_PROGRESS`, xem mục 5.2).

---

## 7. Chuẩn hoá & xác thực số điện thoại (R4)

`phoneValidator.ts` (hàm thuần, không gọi API bên ngoài — xem mục 3):

1. Loại bỏ khoảng trắng, dấu `-`, `.`.
2. Nếu bắt đầu bằng `+84` hoặc `84`, chuyển về dạng bắt đầu bằng `0`.
3. Regex đầu số hợp lệ: `^0(3|5|7|8|9)\d{8}$` (đúng 10 chữ số).
4. Nếu độ dài < 10 → `errorType: "missing"` ("thiếu"); nếu > 10 → `errorType: "excess"` ("thừa"); nếu đúng 10 số nhưng sai đầu số → `errorType: "invalidPrefix"` (không phải số điện thoại hợp lệ, "chưa đúng định dạng"). Lớp gọi ngoài dịch `errorType` này thành 1 tin `AI_PHONE_INVALID` do AI viết (mục 4.2).
5. Chỉ chạy validator trên tin nhắn có chuỗi số liên tiếp ≥ 8 ký tự, tránh nhận nhầm câu chat thường có vài chữ số.
6. **Nguyên tắc bắt buộc**: hàm trả về kết quả dạng `{ valid: boolean, normalizedPhone: string | null, errorType: "missing" | "excess" | "invalidPrefix" | null }`. Toàn bộ phần còn lại của hệ thống (webhook, `flowEngine.ts`) **chỉ được phép gọi sang `sheetsService.appendLead()` khi `valid === true`**. Bất kỳ giá trị `valid === false` nào (thiếu số, thừa số, sai đầu số, hay không đủ điều kiện để coi là số điện thoại) đều phải dừng lại ở bước trả lời `AI_PHONE_INVALID` — không có ngoại lệ, không ghi tạm/ghi nháp vào Sheet rồi sửa lại sau.

---

## 8. Ghi Google Sheet (R5)

`sheetsService.appendLead(row)` — dùng Sheets API `values.append`/`values.update`, **không format lại sheet** — chỉ ghi giá trị thô (riêng cột H là công thức, xem dưới) vào dòng trống tiếp theo của đúng tab tháng tương ứng (mục 8b). Bot tự động ghi các cột **A, B, C, E, F, H** cho mọi lead; cột D, G để trống chờ nhân viên điền tay (xem mục 1).

**Điều kiện bắt buộc trước khi gọi hàm này**: `appendLead()` chỉ được `flowEngine.ts` gọi tới sau khi `phoneValidator` trả về `valid === true` (mục 7, điểm 6). Số điện thoại thiếu số, thừa số, sai đầu số, hoặc bất kỳ trường hợp không chắc chắn nào khác đều **không được phép làm phát sinh bất kỳ thay đổi nào trên Sheet** — không thêm dòng, không ghi ô, không cập nhật dòng đã có. Trang tính chỉ có tác động khi và chỉ khi số điện thoại đã được xác định chính xác là hợp lệ.

> **Cột H (cập nhật theo chỉ đạo chủ dự án)**: chính thức lưu **công thức `HYPERLINK`** dẫn trực tiếp vào đúng khung chat của khách trên Meta Business Suite:
> ```
> =HYPERLINK("https://business.facebook.com/latest/inbox/all?asset_id=PAGE_ID&selected_item_id=PSID&thread_type=FB_MESSAGE", "Link chat trực tiếp với khách trên Facebook")
> ```
> **Bắt buộc phải có cả `asset_id` (mã Fanpage) lẫn `thread_type=FB_MESSAGE`** — thiếu 1 trong 2, Meta Business Suite không định tuyến được và luôn mở nhầm cuộc trò chuyện đầu tiên trong danh sách thay vì đúng khách (lỗi đã từng gặp với định dạng URL `/inbox/messenger` cũ, không có `asset_id`/`thread_type`). `PAGE_ID` đọc từ `process.env.FB_PAGE_ID`, mặc định `523264577527911` (Fanpage "Bất động sản giá rẻ Hòa Bình") nếu không set. Ghi bằng `valueInputOption: USER_ENTERED` (khác `RAW` dùng cho các cột còn lại) để Google Sheet parse thành công thức bấm được thay vì text thô. PSID lấy trực tiếp từ dữ liệu bot đã có sẵn hợp lệ — tin nhắn Messenger trực tiếp dùng PSID gốc; lead chốt từ comment dùng `resolvedPsid` mà Facebook trả về sau khi gửi Private Reply đầu tiên (đã lưu `mappedPsid`). Không lấy được PSID thì để trống cột H, không ghi gì. **Khác với** ý tưởng "link Facebook cá nhân của khách" đã bị loại bỏ trước đó (dựng từ `from.id` của comment, cần trình duyệt giả lập đăng nhập tài khoản admin để đọc — rủi ro chính sách Facebook, xem mục 14): cách làm này chỉ ghép công thức tĩnh từ PSID đã có sẵn, không gọi thêm API nào, không đăng nhập giả lập gì cả — ý tưởng "link cá nhân" nói trên **vẫn bị loại bỏ, không đổi**.

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

Tab **"Tháng 9" là form mẫu chuẩn** cho toàn bộ dự án ("tất cả theo form của tháng 9"). Khi cần tạo tab tháng mới, `ensureSheetExists()` nhân bản (`duplicateSheet`) từ tab "Tháng 9", sau đó xoá text mẫu từ dòng 2 trở đi ở **cột A-E, F và G** — tab mới bắt đầu trống dữ liệu ở các cột này (không còn giữ lại bản copy F từ tab mẫu như trước nữa, xem mục 9: round-robin giờ tự nối tiếp sang tab tháng liền trước thay vì dựa vào giá trị F chép sẵn). **Không đụng cột H khi xoá dữ liệu mẫu lúc tạo tab mới** (hành vi hiện tại của `ensureSheetExists()`, giữ nguyên bất kể nội dung mẫu là gì) — cột H giờ đã thuộc phạm vi ghi của `appendLead` (mục 8) nhưng chỉ được ghi theo từng dòng lead cụ thể khi có PSID, không phải việc dọn dẹp mẫu lúc tạo tab; nếu tab "Tháng 9" có sẵn giá trị mẫu ở cột H từ dòng 2 trở đi, giá trị đó sẽ còn nguyên trên các tab mới nhân bản cho đến khi có dòng lead mới ghi đè. Chỉ xoá **nội dung ô** ở A-E/F/G, không đụng định dạng/data validation (dropdown) ở bất kỳ cột nào — dropdown cột F vẫn giữ nguyên để còn đọc danh sách nhân sự (mục 9).

Tab **"Tháng 9"** là ngoại lệ duy nhất: đây là tab gốc, cột F của nó **là dữ liệu thật** do nhân viên pre-fill sẵn từ trước khi có bot (không phải bản copy tự động) — nguyên tắc "giữ nguyên giá trị F đã có, không ghi đè" ở mục 9 áp dụng cho tab này như bình thường.

### 8c. Theo dõi khách "hỏi lại" sau khi đã CLOSED (tab "Hỏi lại")

Khi khách đã `CLOSED` (đã cho số điện thoại hợp lệ, đã gán nhân viên) nhắn tiếp bất kỳ nội dung gì — dù qua tin nhắn Messenger hay comment thêm — và tin nhắn đó **không phải 1 lần gõ sai định dạng số điện thoại** (mục 6, 7): bot trả lời 1 tin `AI_FOLLOWUP_CLOSED` rồi thực hiện thêm bước sau, tách biệt hoàn toàn khỏi luồng chốt lead ở mục 8:

1. Quét ngay nội dung tin nhắn/comment bằng `phoneValidator` (cùng ngưỡng "chuỗi số liên tiếp ≥ 8 ký tự" ở mục 7 điểm 5):
   - Có số điện thoại **hợp lệ** và **khác** số đã ghi trên hồ sơ khách (`conversations.phone`) → đây là 1 lần khách **sửa số điện thoại**. Cập nhật `conversations.phone` sang số mới, đồng thời **ghi đè cột B (SĐT)** của đúng dòng lead cũ trên tab tháng gốc sang số mới — **chỉ sửa cột B**, giữ nguyên mọi cột khác (tên khách, nguồn khách, nhân viên phụ trách...).
   - Không có số, hoặc có số nhưng **giống hệt** số đã ghi → giữ nguyên `conversations.phone`, không sửa gì trên tab tháng gốc.
2. Tìm dòng lead cũ theo số điện thoại (số **đã cập nhật** nếu vừa sửa ở bước 1, hoặc số cũ nếu không sửa) bằng cách quét cột B của **tất cả các tab "Tháng {N}"** hiện có trên trang tính (không quét tab "Hỏi lại"). Dừng lại ngay khi tìm thấy dòng đầu tiên khớp.
3. Copy **toàn bộ giá trị cột A-H** của dòng tìm được (đã phản ánh đúng số điện thoại mới nếu vừa sửa ở bước 1).
4. Dán vào tab **"Hỏi lại"** — tự dò dòng trống tiếp theo tính từ dòng 2 theo CỘT B (dòng nào đã có SĐT thì bỏ qua, chuyển xuống dòng kế tiếp để dán, giống hệt cách dò dòng trống khi ghi lead mới ở mục 8).

**Giả định quan trọng**: tab **"Hỏi lại" phải được tạo sẵn thủ công** trên Sheet thật (cùng header A-H như các tab tháng) — bot **không tự tạo** tab này như cách tự tạo tab tháng mới ở mục 8b. Nếu tab "Hỏi lại" chưa tồn tại, thao tác ghi sẽ lỗi và được log vào Firestore `errors` (mục 10) để xử lý thủ công, không làm mất dữ liệu khách đã chốt lead trước đó (lead gốc trên tab tháng không bị ảnh hưởng).

Nếu không tìm thấy dòng lead cũ nào khớp số điện thoại đang tra cứu ở bất kỳ tab tháng nào (trường hợp hiếm — ví dụ lần ghi lead gốc trước đó bị lỗi và chỉ được log lỗi chứ chưa lên được Sheet, xem mục 10), thao tác cũng log lỗi tương tự, không tự tạo dòng "khống" trên tab "Hỏi lại" và không sửa gì trên tab tháng.

**Debounce 30 phút cho trường hợp KHÔNG có gì mới** (cập nhật quyết định — trước đây "không chống trùng lặp tuyệt đối", nay chủ dự án yêu cầu chặn bớt dòng rác khi khách chat qua lại dồn dập): chỉ áp dụng cho nhánh khách **không sửa số điện thoại** (không có số, hoặc số giống hệt số cũ) ở bước 1 phía trên. Bot lưu thêm `conversations.lastFollowUpTrackedAt` = lần gần nhất **thực sự** ghi 1 dòng vào tab "Hỏi lại" cho khách đó (khác `lastFlowSentAt` — field đó vẫn cập nhật ở MỌI lượt, phục vụ cửa sổ quét của `reminderService`, mục 5.4, không dùng chung cho debounce này):
- Nếu khách nhắn/comment lại mà **chưa đủ 30 phút** kể từ `lastFollowUpTrackedAt` → bỏ qua hoàn toàn bước 2-4, **không** tạo dòng mới trên tab "Hỏi lại" (khách vẫn nhận `AI_FOLLOWUP_CLOSED` bình thường ở bước trả lời, chỉ riêng thao tác ghi Sheet bị chặn).
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
- Với **mọi** trường hợp số điện thoại không hợp lệ ở trên: assert rõ ràng rằng `sheetsService.appendLead()` **không hề được gọi** (mock/spy hàm này trong test `flowEngine`) — không chỉ kiểm tra `errorType`/nội dung `AI_PHONE_INVALID` trả về mà còn phải kiểm tra Sheet không bị tác động.
- Test nhánh "hỏi lại" (mục 5.2/6): state `IN_PROGRESS`, khách nhắn tin tự do không có chuỗi số nào → assert `messagesToSend` là `[{ kind: 'AI_FREE_TEXT' }]`; lặp lại 2-3 lần liên tiếp vẫn phải nhận lại đúng ý định này mỗi lần. State `CLOSED`, khách nhắn thêm không có số hoặc số giống hệt số cũ → assert chỉ nhận `[{ kind: 'AI_FOLLOWUP_CLOSED' }]`, không gọi `appendLead`, không đổi state (mục 6, AC6).
- Test nhánh CLOSED + số điện thoại (mục 6, AC6/AC15): số **sai định dạng** → assert nhận đúng `AI_PHONE_INVALID` tương ứng, không gọi `appendLead`/`copyLeadToFollowUpSheet`/`updateLeadPhoneAndCopyToFollowUpSheet`. Số **hợp lệ nhưng khác số cũ** → assert `updateLeadPhoneAndCopyToFollowUpSheet` được gọi đúng 1 lần với `(oldPhone, newPhone)`, `copyLeadToFollowUpSheet` KHÔNG được gọi, hồ sơ Firestore lưu lại đúng `newPhone`. Số **giống hệt số cũ** → assert chỉ gọi `copyLeadToFollowUpSheet`, không gọi hàm sửa số.
- Test tab "Hỏi lại" (mục 8c, `copyLeadToFollowUpSheet` / `updateLeadPhoneAndCopyToFollowUpSheet`): khách CLOSED nhắn lại → assert hàm tương ứng được gọi đúng 1 lần với đúng số điện thoại; assert không gọi khi `conversations.phone` là `null` (chưa từng có lead thật, dữ liệu bất thường). Test riêng hàm tìm dòng theo SĐT: tìm thấy ở tab tháng bất kỳ → trả về đúng tên tab + số dòng + toàn bộ cột A-H; không tìm thấy ở tab tháng nào → throw để lớp gọi ngoài log lỗi thay vì âm thầm bỏ qua. Test `updateLeadPhoneAndCopyToFollowUpSheet` chỉ ghi đè đúng cột B trên tab gốc, các cột còn lại của dòng copy sang "Hỏi lại" giữ nguyên như dữ liệu gốc.
- Test nhánh comment cho số ngay trong comment (mục 5.3, dùng fixture `test/fixtures/commentWithPhone.json`): comment chứa số hợp lệ → assert `appendLead` được gọi đúng 1 lần, không có câu trả lời/mời để lại số nào được gửi trước đó, khách nhận `AI_PHONE_CONFIRMED` qua Private Reply; comment chứa số không hợp lệ → assert `AI_PHONE_INVALID` qua Private Reply, `appendLead` không được gọi; comment không có số → assert 1 tin `AI_FREE_TEXT` (kèm chào nếu là lần đầu).
- Test cột C (mục 8): với input `first_name = "A"`, `last_name = "Nguyễn Văn"` → assert giá trị ghi vào cột C là `"Nguyễn Văn A"` (không phải `"A Nguyễn Văn"`).
- Test cột E (mục 8, AC13): số điện thoại hợp lệ đến từ tin nhắn Messenger (`type: 'TEXT'`) → assert `appendLead` được gọi với `source: "Tin nhắn"`; số điện thoại hợp lệ đến từ comment (`type: 'FEED_COMMENT'`, cả nhánh đã map PSID lẫn nhánh comment đầu tiên) → assert `appendLead` được gọi với `source: "Cmt"`. Đồng thời assert lệnh ghi cột E không nằm chung 1 vùng với cột A-C (không được phép đụng cột D xen giữa).
- Test lớp AI trả lời tự do (mục 4.2, AC3/AC8/AC9/AC16):
  - `flowEngine.processInput` (hàm thuần, không cần gọi Gemini thật): free text trên state `NEW` hoặc `IN_PROGRESS` không có SĐT → assert `messagesToSend` đúng `[{ kind: 'AI_FREE_TEXT' }]`. Nút bấm (`BUTTON`) → assert đúng `[{ kind: 'AI_TOPIC', topic: ... }]`. Nhánh `CLOSED` → assert đúng `[{ kind: 'AI_FOLLOWUP_CLOSED' }]` hoặc `[{ kind: 'AI_PHONE_INVALID', errorType: ... }]` tuỳ nội dung khách gửi.
  - `geminiService.buildSystemInstruction` (hàm thuần): assert luôn nhúng đúng nội dung `knowledgeBase.ts`; assert không có tham số nào của hàm này chấp nhận/truyền số điện thoại khách vào prompt.
  - `webhook/facebook.ts` (mock `geminiService.generateAiReply`, không gọi API thật): với mỗi `ReplyIntent` trong `messagesToSend` → assert gọi đúng 1 lần `generateAiReply` kèm đúng `intent`/lịch sử/tên khách/`isNewCustomer`, gửi cho khách đúng text trả về; khi `generateAiReply` reject hoặc trả về chuỗi rỗng → assert khách vẫn nhận được 1 tin (fallback đúng nguyên văn `aiFallbackText`) và `logError` được gọi.
  - Assert `conversations.aiHistory` sau 1 lượt AI trả lời có thêm đúng 2 phần tử mới (`user` + `model`) và bị cắt còn tối đa 10 phần tử khi vượt ngưỡng.

---

## 14. Giới hạn kỹ thuật đã biết (không phải bug, không cần "sửa cho chạy được")

- Facebook Graph API không trả về địa chỉ/quê quán/tỉnh thành của người dùng Messenger — cột D chỉ có dữ liệu khi khách tự nói ra trong chat và nhân viên tự ghi thêm.
- **Cột H đã được triển khai (cập nhật theo chỉ đạo chủ dự án, xem mục 8)**: ghi công thức `HYPERLINK` dẫn vào hộp thư Messenger của khách trên Facebook Business Suite, dựng từ PSID bot đã có sẵn hợp lệ — không gọi thêm API, không đăng nhập giả lập. **Vẫn giữ nguyên bị loại bỏ**: ý tưởng lấy **link Facebook cá nhân của khách** (khác với link hộp thư ở trên) — không triển khai dưới bất kỳ hình thức nào, kể cả tự động (dựng link từ `from.id` của comment, vốn khả thi hợp lệ) lẫn thủ công (nhân viên copy tay từ hộp thư Page). Lý do (để tham khảo nếu sau này cân nhắc lại): phương án tự động toàn phần bằng trình duyệt giả lập đăng nhập tài khoản admin là hành vi trái chính sách Facebook, rủi ro khoá cả Page quản trị — rủi ro này không áp dụng cho công thức HYPERLINK ở trên vì không cần đăng nhập giả lập gì cả.
- Hosting free-tier có thể có độ trễ khởi động (cold start) vài chục giây nếu không có traffic — ưu tiên Cloud Run/Cloudflare Workers để giảm thiểu.
- **Retry gửi tin Messenger không idempotent**: nếu 1 lệnh gọi Facebook Send API thực ra đã gửi thành công nhưng phản hồi bị rớt mạng trước khi bot nhận được (timeout/connection reset), `withRetry` sẽ hiểu nhầm là thất bại và gửi lại — khách có thể nhận trùng 1 tin nhắn. Facebook Send API không hỗ trợ idempotency key nên không thể loại bỏ hoàn toàn rủi ro này bằng code; chấp nhận như rủi ro tồn dư (hậu quả nhẹ: khách nhận trùng tin, không mất lead, không trùng dòng Sheet).
- **Giá trị cột F có sẵn (pre-fill) trên tab "Tháng 9" được tin tưởng tuyệt đối, không đối chiếu lại dropdown hiện tại**: nếu dòng vừa ghi lead trên tab "Tháng 9" đã có sẵn giá trị F (dữ liệu thật do nhân viên pre-fill từ trước khi có bot — mục 8b), bot dùng luôn giá trị đó làm `assignedStaff`, kể cả khi người đó đã bị xoá khỏi dropdown hiện tại (vd nhân viên nghỉ việc nhưng dữ liệu mẫu chưa cập nhật). Đây là đánh đổi có chủ đích để tôn trọng đúng yêu cầu "không đụng cột F đã có" trên tab gốc — nếu muốn bot tự sửa các ô F pre-fill không còn hợp lệ, cần yêu cầu riêng. Các tab tháng sau do bot tự tạo (mục 8b) không còn pre-fill F nữa nên không gặp trường hợp này.
- **Round-robin nối tiếp xuyên tháng qua `findLastValidAssignment` đệ quy lùi tab** (mục 9): khi sang tab tháng mới (cột F trống hoàn toàn từ dòng 2 — mục 8b), lead đầu tiên của tháng đó tự động lùi sang tab tháng liền trước (và xa hơn nữa nếu tab đó cũng chưa có lịch sử hợp lệ, hoặc chưa từng được tạo) để tìm người được gán gần nhất, nên thứ tự luân phiên không bị "reset" giữa các tháng. Giới hạn còn lại: việc lùi tab chỉ dựa vào số thứ tự tháng suy ra tên tab ("Tháng 10" → "Tháng 9" → dừng), không hiểu các tên tab đặt khác quy ước — nếu ai đó đổi tên tab thủ công sai định dạng "Tháng {N}", chuỗi lùi tab sẽ đứt và thuật toán coi như không có lịch sử trước đó.
- **Chi phí AI & lựa chọn nền tảng (mục 4.2, cập nhật quyết định — chủ dự án đã duyệt)**: thay vì gọi thẳng Gemini Developer API bằng 1 API key free tier (giới hạn ~20 lượt/ngày, không đủ cho quy mô vận hành thật), bot gọi qua **"9Router"** — proxy tự host của chủ dự án qua mạng Tailscale, xoay vòng nhiều tài khoản **Google AI Pro/Ultra (Google One)** cá nhân để đạt hạn mức hàng nghìn lượt/ngày. Đây là đánh đổi **có chủ đích, đã được chủ dự án cân nhắc và duyệt**, thay thế nguyên tắc trước đó (cấm dùng quota Pro/Ultra cho traffic backend thật) — chủ dự án chấp nhận rủi ro đi kèm: (1) **phụ thuộc uptime của router tự host và mạng Tailscale** — nếu router hoặc kết nối Tailscale gián đoạn, mọi lượt gọi AI sẽ lỗi/timeout và rơi vào fallback `aiFallbackText` (mục 4.2, AC16) cho tới khi router hoạt động lại, không phải lỗi code; (2) **rủi ro chính sách từ phía Google** với việc dùng quota gói tiêu dùng cá nhân (Pro/Ultra) cho mục đích tự động hoá quy mô lớn — nằm ngoài phạm vi kỹ thuật bot có thể kiểm soát, do chủ dự án tự chịu trách nhiệm quản lý các tài khoản đó. Model gọi qua router là alias `ag/gemini-3.8-flash-high` (không phải tên model chính thức của Google, do phía router tự đặt) — cấu hình qua `AI_ROUTER_URL`/`AI_MODEL_NAME`, mặc định trong code trỏ về địa chỉ Tailscale nội bộ của router hiện tại.
- **Rủi ro hallucination của AI được giảm thiểu bằng system instruction cố định, không phụ thuộc AI "tự giác"** (mục 4.2): ép buộc chỉ dùng dữ kiện trong `knowledgeBase.ts`, cấm bịa thêm giá/pháp lý/cam kết ngoài file đó. **Đánh đổi có chủ đích (chủ dự án đã duyệt, xem mục 4.2)**: hành động xin số Zalo/điện thoại KHÔNG còn do code tự thêm cứng như thiết kế trước — nay giao hẳn cho AI (thông qua `PHONE_CTA_HINT` trong `describeIntent`, mục 4.2), đổi lấy câu trả lời tự nhiên/không lặp lại y hệt mỗi lần. Rủi ro tồn dư: nếu router/model có lúc bỏ sót lời mời để lại số dù đã được yêu cầu rõ ràng trong prompt, mục tiêu chốt lead của 1 vài lượt cụ thể có thể bị ảnh hưởng — chấp nhận được vì (a) mỗi lượt hỏi thêm của cùng 1 khách đều lặp lại yêu cầu này (không phải chỉ 1 lần duy nhất), (b) đổi lại được trải nghiệm tự nhiên hơn nhiều so với câu CTA lặp lại y hệt mỗi lần.
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

- **AC1**: Bấm "Ở đâu?" hoặc "Giá bao nhiêu?" → nhận đúng 1 tin `AI_TOPIC` (AI trả lời đúng chủ đề, kèm lời mời để lại số Zalo trong cùng câu).
- **AC2**: Bấm "Có sổ đỏ không?" → nhận đúng 1 tin `AI_TOPIC` (AI trả lời đúng chủ đề pháp lý, kèm lời mời để lại số Zalo trong cùng câu).
- **AC3**: Nhắn tin tự do khi chưa từng tương tác → nhận đúng 1 tin `AI_FREE_TEXT` — chào mở đầu + trả lời bám sát đúng câu hỏi của khách (dựa trên `knowledgeBase.ts`, mục 4.2 — vd hỏi sổ đỏ thì được trả lời đúng trọng tâm pháp lý) + lời mời để lại số Zalo, tất cả trong CÙNG 1 câu.
- **AC4**: Gửi số điện thoại được xác nhận **chính xác hợp lệ** qua tin nhắn Messenger (đúng độ dài + đúng đầu số) → Sheet có dòng mới đúng cột A, B, C, F và cột E = `"Tin nhắn"` (cột D thêm nếu nhân viên có ghi tay; cột G để trống; cột H = link hộp thư Messenger dựng từ PSID, để trống nếu không lấy được PSID) → khách nhận 1 tin `AI_PHONE_CONFIRMED`.
- **AC5**: Gửi số điện thoại **không hợp lệ** ở bất kỳ dạng nào (9 số/thiếu, 11 số/thừa, hoặc đúng 10 số nhưng sai đầu số) → nhận đúng 1 tin `AI_PHONE_INVALID` tương ứng, và Sheet **tuyệt đối không** có dòng mới, không ô nào bị ghi/sửa/xoá — kiểm tra cả 3 trường hợp, không chỉ thiếu/thừa.
- **AC6**: Sau khi đã chốt lead (state = `CLOSED`):
  - Khách nhắn thêm nội dung không có số hợp lệ khác (không có số, hoặc số giống hệt số cũ) → bot **chỉ trả lời đúng 1 tin `AI_FOLLOWUP_CLOSED`**, không gửi lại các câu khác, không tạo lead mới trên tab tháng, không đổi state — dòng lead cũ (tra theo số điện thoại đã ghi) được copy nguyên trạng sang tab "Hỏi lại" (mục 8c).
  - Khách gửi số điện thoại **sai định dạng** → nhận đúng 1 tin `AI_PHONE_INVALID` tương ứng, tuyệt đối không đụng Sheet (kể cả tab "Hỏi lại").
  - Khách gửi số điện thoại **hợp lệ nhưng khác số cũ** → coi là sửa số: cột B của dòng lead cũ trên tab tháng gốc được cập nhật thành số mới, dòng đã sửa được copy sang tab "Hỏi lại", khách nhận 1 tin `AI_FOLLOWUP_CLOSED` (mục 6, 8c, AC14).
- **AC7**: Gửi N+1 lead hợp lệ liên tiếp (N = số nhân viên) → người thứ N+1 trùng với người thứ 1.
- **AC8**: Comment dưới bài Page **không chứa số điện thoại** → nhận 1 lời chào ngắn không qua AI (probe lấy PSID) rồi đúng 1 tin `AI_FREE_TEXT` (AI trả lời câu hỏi trong comment + mời để lại số Zalo, mục 4.2) qua Private Reply, chuyển state `IN_PROGRESS`. Nếu người này sau đó nhắn lại / hỏi lại mà vẫn chưa cho số (dù nhắn tin trực tiếp hay comment thêm) → nhận tiếp `AI_FREE_TEXT` (AC9); chỉ khi đã cho số hợp lệ (state `CLOSED`) thì các lần hỏi lại tiếp theo mới chuyển sang chỉ nhận `AI_FOLLOWUP_CLOSED` (AC6).
- **AC9**: State `IN_PROGRESS` (đã nhắn cho khách 1 lần rồi), khách nhắn thêm dòng thứ 2 trở đi hoặc nhắn lại mà không kèm số điện thoại → nhận đúng 1 tin `AI_FREE_TEXT` (AI trả lời đúng câu hỏi mới + mời để lại số Zalo trong cùng câu, không chào lại); mỗi lần nhắn thêm tiếp theo mà vẫn chưa có số hợp lệ đều lặp lại đúng cách này.
- **AC10**: Comment dưới bài Page **có sẵn số điện thoại hợp lệ ngay trong nội dung comment** → Sheet có dòng mới đúng cột A, B, C, F (không cần khách nhắn tin riêng, không có câu trả lời/mời để lại số nào được gửi trước) nhưng cột E = `"Cmt"` (khác AC4 vì nguồn khác), khách nhận 1 tin `AI_PHONE_CONFIRMED` qua Private Reply.
- **AC11**: Lead đầu tiên ghi vào tab tháng mới (cột F còn trống) → được gán đúng người kế tiếp ngay sau người cuối cùng được gán hợp lệ ở tab tháng liền trước, không quay lại đầu danh sách dropdown.
- **AC12**: Tên khách ghi vào cột C đúng thứ tự Việt Nam (Họ + tên đệm + tên gọi), không bị đảo ngược theo thứ tự `first_name`+`last_name` kiểu phương Tây.
- **AC13**: Cột E (Nguồn khách) được bot tự động điền đúng theo kênh phát sinh số điện thoại — `"Tin nhắn"` khi chốt lead từ tin nhắn Messenger (AC4), `"Cmt"` khi chốt lead từ comment (AC10) — và cột D vẫn hoàn toàn không bị đụng tới trong cả 2 trường hợp.
- **AC14**: Khách đã `CLOSED` nhắn lại, không có số điện thoại khác → dòng lead cũ của khách (tra đúng theo số điện thoại đã ghi trên hồ sơ) được copy nguyên vẹn cột A-H sang tab "Hỏi lại", vào đúng dòng trống tiếp theo (bỏ qua các dòng đã có dữ liệu); tab tháng gốc chứa lead đó không bị chỉnh sửa gì. Khách hỏi lại nhiều lần **cách nhau trên 30 phút** → mỗi lần tạo thêm 1 dòng mới trên tab "Hỏi lại"; hỏi lại nhiều lần **trong vòng 30 phút kể từ lần ghi gần nhất** → chỉ dòng đầu tiên được ghi, các lần sau trong cùng cửa sổ 30 phút bị bỏ qua, không tạo thêm dòng (mục 8c, debounce mới).
- **AC15**: Khách đã `CLOSED` gửi lại 1 số điện thoại **hợp lệ nhưng khác** số đã ghi → cột B của đúng dòng lead cũ trên tab tháng gốc được sửa thành số mới (các cột khác của dòng đó giữ nguyên), dòng **đã sửa** (không phải bản gốc) được copy sang tab "Hỏi lại", hồ sơ Firestore của khách cũng cập nhật sang số mới để lần hỏi lại tiếp theo tra cứu đúng (mục 6, 8c).
- **AC16**: Khi gọi Gemini API lỗi/timeout (đã hết số lần retry của `withRetry`, mục 10) hoặc trả về chuỗi rỗng → bot vẫn gửi cho khách đúng 1 câu trả lời dự phòng (nguyên văn `aiFallbackText`) thay vì im lặng hoặc bỏ lượt, đồng thời `logError` được ghi lại để theo dõi tần suất fallback (mục 4.2, 10).


---

## 15. Chỉ thị kỹ thuật toàn diện và chuẩn xác dành cho bot Fanpage (Cập nhật 08/09/2026)

### 15.1. Bàn giao người thật chat (Human Takeover) - Chống bot chen ngang
- **Bắt sự kiện tin nhắn từ quản trị viên / nhân viên (Echo Event):**
  - Khi `event.message.is_echo === true`:
    - Nếu `app_id` trùng với `FB_APP_ID` của bot: bỏ qua (tin bot tự gửi).
    - Nếu không có `app_id` hoặc `app_id !== FB_APP_ID` (người thật thao tác trên Meta Business Suite hoặc app Messenger/Facebook):
      - Lấy `recipient_id` (PSID của khách).
      - Cập nhật ngay vào Firestore: `lastHumanReplyAt = Date.now()`.
      - Return ngay lập tức, không đưa vào luồng AI.
- **Khóa mõm bot trong thời gian người thật tiếp quản:**
  - Đầu hàm `handleMessagingEvent` và `handleMappedCommentTurn`:
    - Đọc dữ liệu cuộc hội thoại của khách từ Firestore.
    - Điều kiện: `Date.now() - conversation.lastHumanReplyAt < 10 * 60 * 1000` (trong vòng 10 phút kể từ tin nhắn cuối của người thật):
      - Bot giữ im lặng tuyệt đối 100%, return ngay lập tức.
    - Quá 10 phút mà nhân viên không nhắn thêm gì và khách nhắn tiếp câu mới, bot tự động hoạt động trở lại.

### 15.2. Giới hạn độ dài câu trả lời và quy tắc băm tối đa 3 tin nhắn
- **Trong `src/ai/geminiService.ts`:**
  - Mỗi lượt trả lời chỉ được phép viết 2-3 câu ngắn gọn (tổng độ dài dưới 60 từ), `max_tokens: 250`.
  - Văn phong đi thẳng vào trọng tâm (vị trí, giá, đường đi, pháp lý). Tự nhiên như người thật gõ phím nhanh trên điện thoại.
  - Nghiêm cấm giải thích dài dòng, không liệt kê lan man khi khách chưa hỏi sâu.
- **Trong `src/webhook/facebook.ts` (`splitMessageIntoBubbles` và `sendMessageSequence`):**
  - Giới hạn cứng: mỗi lượt phản hồi chỉ được phép băm tối đa 3 bong bóng tin nhắn (từ 1 đến 3 tin). Tuyệt đối không băm thành 4 hay 5 tin.
  - Nếu câu trả lời tách ra > 3 đoạn, bắt buộc gộp các câu giữa lại để mảng có tối đa 3 phần tử.
  - Bong bóng thứ 3 dành cho câu xin số Zalo/điện thoại (khi có cờ xin số).
  - Duy trì độ trễ tự nhiên từ 2 đến 3 giây giữa các tin nhắn kèm typing indicator (`getRandomMessageDelayMs`).

### 15.3. Nhịp điệu xin số điện thoại chuẩn xác theo số lượt chat
- Sử dụng `customerMessageCount` và `askPhoneCount` trong Firestore:
  - **Mốc 1 (Lượt chat thứ 3):** Khách trao đổi được 2 câu cơ bản, đến tin thứ 3 bot giải đáp và ở bong bóng thứ 3 lịch sự xin số Zalo lần đầu tiên kèm lợi ích thiết thực (sơ đồ phân lô, bảng giá chi tiết). Cập nhật `askPhoneCount = 1` và lưu `lastAskedPhoneTurn = 3`.
  - **Mốc 2 (Lượt chat thứ 6):** Lượt 4 và 5 nhiệt tình giải đáp đúng trọng tâm, TUYỆT ĐỐI KHÔNG xin số ở 2 tin này. Đến tin thứ 6 khách vẫn chưa cho số, bot mới lịch sự nhắc xin số lần 2 nhẹ nhàng. Cập nhật `askPhoneCount = 2`.
  - **Mốc 3 (Từ lượt thứ 7 trở đi):** Tế nhị, chỉ nhắc nhẹ khi cách tối thiểu 4-5 lượt chat hoặc khi khách hỏi sâu về thủ tục pháp lý, đặt cọc, hoặc lịch xe đi xem đất thực tế.
  - **Khi có số điện thoại:** Khách gửi số hợp lệ -> ngắt toàn bộ quy tắc xin số, ghi Google Sheet, chia sale round-robin, chuyển trạng thái sang CLOSED và gửi 1 tin xác nhận. Khách gửi số sai/thiếu (`AI_PHONE_INVALID`) -> gửi câu thông báo kiểm tra lại số, không tính lượt này vào các mốc xin số thông thường.

### 15.4. Chống trả lời trùng lặp câu chữ
- AI đối chiếu kỹ toàn bộ mảng lịch sử `aiHistory`.
- Tuyệt đối không lặp lại kiểu câu mở đầu giữa các lượt chat liên tiếp.
- Đã chào ở lượt trước thì lượt sau không chào lại, đi thẳng vào trả lời câu hỏi.

### 15.5. Nhận diện giới tính đa tầng và soi avatar chuẩn xác
- **Tên thuần Nam:** Văn, Hùng, Dũng, Cường, Thắng, Tuấn, Đức, Hoàng, Long, Hải, Sơn, Nam, Quân, Huy, Thành, Quang, Việt, Phúc, Thịnh, Kiên, Trung, Trọng, Tiến, Toàn, Khoa, Đạt, Khôi, Vũ, Nghĩa, Phong, Bách, Triều, Hiếu, Bảo...
- **Tên thuần Nữ:** Thị, Hoa, Mai, Lan, Hương, Thảo, Trang, Linh, Hằng, Ngân, Thủy, Yến, Dung, Nga, Phương, Hạnh, Vân, Ngọc, Nhung, Trâm, Oanh, Thư, Quyên, Huệ, Diệp, Loan, Quỳnh, My, Diệu, Thắm, Cúc...
- **Tên trung tính:** Anh, Bình, Hà, Giang, Khánh, Minh, Thanh, Dương, Tú, An, Quý.
- **Xử lý tên trung tính & không rõ ràng:**
  - Không đoán mò, fallback về UNKNOWN để kích hoạt soi avatar qua Gemini Vision (timeout tối đa 3 giây).
  - Avatar nhận diện rõ Nam -> xưng em, gọi anh.
  - Avatar nhận diện rõ Nữ -> xưng em, gọi chị.
  - Avatar phong cảnh, hoa lá, đồ vật, che mặt, timeout -> fallback về đại từ lịch sự "anh/chị". Tuyệt đối không gọi cộc lốc bằng tên riêng.
  - Khách tự xưng "anh"/"chị" trong tin nhắn -> ưu tiên tuyệt đối theo khách.

### 15.6. Cài đặt thông tin liên hệ chân bài đăng trên Fanpage
- Không chèn dòng chữ "Người đăng: Nguyễn Trọng Hiếu" vào nội dung bài viết (thông tin người đăng do ứng dụng Facebook hiển thị riêng).
- Ở phần chân bài (trước các thẻ hashtag) chỉ giữ lại thông tin liên hệ theo mẫu:
  ```
  Hotline / Zalo tư vấn và xe đưa đón xem đất: 0916.060.254
  ```

### 15.7. Kho ảnh chuẩn Hòa Bình và cơ chế Context Mapping (searchContextImageUrl)
- **3 Nhóm kho ảnh tuyển chọn (`HOA_BINH_IMAGE_GROUPS`):**
  - **Nhóm 1 (SCENERY - Danh lam thắng cảnh nổi tiếng):** Lòng hồ Thung Nai sông Đà (Vịnh Hạ Long trên núi), Thung lũng Mai Châu sương sớm & mùa lúa, Đèo Thung Khe (đèo Đá Trắng), Đồi thoai thoải & Thác Mu Lạc Sơn.
  - **Nhóm 2 (INFRASTRUCTURE - Công trình trọng điểm & biểu tượng hạ tầng):** Nhà máy Thủy điện Hòa Bình, Cầu Hòa Bình bắc qua sông Đà, Tượng đài Bác Hồ đồi ông Tượng, Tuyến cao tốc Hòa Lạc - Hòa Bình, Phối cảnh quy hoạch Sun Group Đồi Thung Lạc Sơn.
  - **Nhóm 3 (CULTURE - Văn hóa dân tộc & lễ hội đặc sắc):** Lễ hội Khai Hạ người Mường (Di sản phi vật thể quốc gia), Nét đẹp văn hóa cồng chiêng Mường, Không gian nhà sàn truyền thống Mường/Thái, Ẩm thực cơm lam thịt nướng mộc mạc.
- **Thuật toán Context Mapping (`classifyImageCategory`):**
  - Bài viết về nghỉ dưỡng, không gian sống xanh, nhà vườn cuối tuần $\rightarrow$ Nhóm 1 (`SCENERY`).
  - Bài viết về pháp lý, giá trị đất, quy hoạch cao tốc, đầu tư tích sản $\rightarrow$ Nhóm 2 (`INFRASTRUCTURE`).
  - Bài viết về văn hóa, lễ hội, cồng chiêng, nhà sàn, ẩm thực $\rightarrow$ Nhóm 3 (`CULTURE`).
- **Tiêu chuẩn kỹ thuật ảnh:** 100% URL trực tiếp (.jpg/.png), phân giải cao $\ge 1200px$, CDN ổn định, không watermark, gắn mã chống cache (`?sig=`).

### 15.8. Cơ chế chống trùng lặp Webhook, Debounce PSID & Khống chế bong bóng tin nhắn
- **Sự cố thực tế:** Khách Nguyễn Thuỷ bấm quảng cáo Facebook, Meta gửi đồng thời nhiều webhook (7ms apart) và retry do webhook xử lý lâu, kết hợp logic `shouldSplitGreeting` tách 1 turn thành 2 intent (`AI_GREETING` + `AI_FREE_TEXT`) khiến bot gửi liên tiếp 8 tin nhắn lặp nội dung.
- **Khắc phục triệt để:**
  1. **Idempotency (chống retry cùng `mid`):** Cache `processedMids` (TTL 10 phút), hàm `isDuplicateMid(mid)` bỏ qua ngay lập tức nếu `mid` đã từng được tiếp nhận.
  2. **Debounce theo PSID (chống bão webhook quảng cáo):** Cache `lastProcessedAtByPsid`, hàm `isPsidDebounced(psid, 3000)` bỏ qua mọi sự kiện tiếp theo từ cùng 1 PSID trong vòng 3 giây, chỉ xử lý sự kiện đầu tiên.
  3. **Khóa đồng bộ per-PSID:** Cả `handleFirstOpen` và `runFlowTurn` đều được bọc trong `withLock(\`psid:${psid}\`)` đảm bảo không bao giờ có 2 tiến trình trả lời chạy song song cho cùng 1 khách.
  4. **Quy tắc 1 Intent duy nhất:** Xóa bỏ hoàn toàn `shouldSplitGreeting`. Mỗi lượt chat chỉ gửi đúng 1 intent (`result.messagesToSend.slice(0, 1)`). AI tự nhận biết `isNewCustomer` để chèn lời chào ngắn gọn ngay đầu câu trả lời nếu là khách mới.
  5. **Khống chế cứng bong bóng tin nhắn:**
     - `splitMessageIntoBubbles`: Tối đa 2 đến 3 bong bóng. Nếu nội dung dài, tự động gộp các câu lại (giữ câu CTA/xin số ở bong bóng thứ 3), cấm băm thành 4-5 tin nhắn vụn.
     - `sendMessageSequence`: Biến `MAX_BUBBLES_PER_TURN = 3` ngắt vòng lặp gửi ngay khi đạt ngưỡng tối đa 3 bong bóng trong 1 lượt chat.

### 15.9. Cố định 3 bong bóng ở lượt đầu tiên & Nhịp điệu xin số chuẩn mực
- **Cấu trúc cố định 3 bong bóng ngay lượt khách hỏi đầu tiên (`customerMessageCount === 1`):**
  - **Bong bóng 1:** Chào hỏi lịch sự theo đúng danh xưng cá nhân hóa (`Dạ em chào anh/chị ạ!`).
  - **Bong bóng 2:** Trả lời ngắn gọn, đúng trọng tâm câu hỏi của khách (giá, diện tích, sổ đỏ, vị trí). Lọc sạch bằng `cleanAnswerBubble`: loại bỏ lời chào đầu câu (tránh trùng bong bóng 1), loại bỏ lời xin số ở cuối và loại bỏ các câu hỏi mở không cần thiết (mua đầu tư hay làm nhà vườn).
  - **Bong bóng 3:** BẮT BUỘC câu xin số Zalo chuẩn mực kèm tài liệu: *"Em có sẵn sơ đồ phân lô và bảng giá chi tiết từng vị trí, anh/chị cho em xin số Zalo để em gửi qua cho mình tiện xem nhé!"* do lớp code ngoài (`facebook.ts`) tự động ghép, không phụ thuộc vào AI.
- **Nhịp điệu các lượt tiếp theo:**
  - Lượt 2 đến 5: Bot chỉ trả lời 1-2 câu giải đáp thắc mắc, tắt cờ xin số (`askPhone: false`).
  - Lượt 6: Bật cờ xin số Mốc 2 (`milestone: 2`), nhắc nhẹ nhàng gửi quy hoạch & bảng giá mới nhất.
  - Lượt $\ge 7$: Giữ tế nhị, chỉ nhắc lại theo chu kỳ (lượt 11, 16...) hoặc khi khách hỏi sâu pháp lý / xem đất.
