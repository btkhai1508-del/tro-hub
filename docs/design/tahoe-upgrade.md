# Trọ-Hub — nâng cấp Tahoe và Liquid Glass

## Nguồn, phạm vi và giới hạn đối chiếu

Tham chiếu chính là `Materials - Light.svg`, `Materials - Dark.svg`, CSS export và bảng typography/Liquid Glass người dùng đính kèm trong hội thoại. Wallpaper được lấy từ chính các SVG đó, không vẽ lại. Bộ 50 SVG icon mới được giữ nguyên artwork; hai lần upload có nội dung giống nhau.

Đường dẫn Figma node `483-8848` được thử lại nhưng môi trường trả lỗi kết nối HTTP403. Công cụ/skill của **01 Superdesign không khả dụng trong phiên này**, vì vậy bản nâng cấp được triển khai trực tiếp trong React/CSS; không tuyên bố đã chạy plugin hoặc xem được canvas Figma. Không cần gửi lại các file SVG/CSS hiện có. Để đối chiếu từng màn hình Figma chính xác hơn cần bản export màn hình đó hoặc công cụ Figma có quyền truy cập.

Các chi tiết lấy từ tham chiếu: wallpaper sáng/tối, nhóm vật liệu, viền sáng/bóng tiếp xúc, bo tròn, hệ chữ Apple, màu artwork. Các cải tiến đề xuất: bố cục theo tác vụ mobile, disclosure, lọc lịch sử, nhóm nhập chỉ số theo phòng, bottom dock quản trị và hỗ trợ bàn phím/hộp thoại. Đây là website quản lý nhà trọ, không tạo cửa sổ hệ điều hành giả.

## Token và component tái sử dụng

| Nhóm | Giá trị áp dụng | Mục đích |
| --- | --- | --- |
| Font | `-apple-system`, `BlinkMacSystemFont`, SF Pro nếu hệ thống có; fallback hệ thống | Không phân phối font Apple |
| Typography | LargeTitle26/32, Title1 22/26, Title2 17/22, Title3 15/20; Body13 desktop/15 mobile; field17 | Theo bảng typography, tăng khả năng đọc tiếng Việt trên mobile |
| Spacing | 4,8,12,16,20,24,32px | `--space-*` |
| Góc | surface34, card20, control12px; sheet28px | Nhất quán giữa các trang |
| Wallpaper | WebP gốc, opacity90%, cover | Chỉ tải theme đang hoạt động |
| Card glass | Light trắng24%, Dark gần đen24%, blur12px; viền sáng và sheen | Thể hiện nền rõ, không giảm opacity của chữ |
| Chrome | Vật liệu riêng cho sidebar, toolbar, dock và popover | Chiều sâu có chủ đích |
| Vùng đọc | `.kit-data-surface`, `.kit-reading-surface`: trắng84% / tối90%, không blur thêm | Bảng số liệu và nội dung dài |
| Form | `.kit-form-surface`: trắng70% / tối84%, không blur thêm | Nhập liệu rõ ràng |
| Chứng từ | Hóa đơn, A4, nền QR trắng đặc | Giữ khả năng đọc/in/quét |
| Icon | `KitIcon`, `AppIcons`, compatibility `Icons3D` | Ảnh SVG external có kích thước xác định, không trùng gradient ID |
| Dialog | `useDialogFocus`, `.tahoe-dialog*` | Focus trap theo stack, Escape, trả focus, khóa cuộn nền |

Export gốc có Light36–84%/Dark10–50% và blur15px. Tint24%/blur12px là điều chỉnh theo yêu cầu tăng độ trong, không phải thông số sao chép nguyên từ Figma. Không phủ kính lên mọi nhóm nội dung; không có lớp làm mờ wallpaper toàn màn hình.

50 SVG được người dùng cung cấp có nền ngoài trong suốt; các lớp màu/kính bên trong là artwork, không xóa nhầm chúng. Bỏ ô nền bọc ngoài ở nội dung. Các icon sidebar/bottom bar giữ nguyên; logo thương hiệu dùng Home mới. Các ký hiệu chuyên biệt như điện, nước, Wi-Fi, máy giặt, QR, in/điện thoại không có bản tương ứng trong bộ mới được xuất thành SVG bổ sung để không đổi ý nghĩa. `symbol-*` xuất từ Lucide hiện có, kèm giấy phép tại `public/icons/kit/LICENSE-lucide.txt`; `service-*` chuyển từ artwork dịch vụ sẵn có. Không tải toàn bộ icon trước.

## Tổ chức màn hình và responsive

| Luồng | Desktop | Mobile |
| --- | --- | --- |
| Đăng nhập/đăng ký | Form đơn, không cột quảng bá/khung OS | Form một cột, input17px, CTA rõ; Zalo dưới đăng nhập thường, ngoài form; viewport thấp ưu tiên cuộn tới field |
| Trang chủ cư dân | Billing + phòng, quick actions | Khoản phí và hành động chính trước; phòng tóm tắt và mở chi tiết; bớt mô tả lặp |
| Hóa đơn | Danh sách theo kỳ + tổng cần trả | Lọc trạng thái, sáu kỳ đầu rồi Xem thêm; giữ đầy đủ kỳ và số tiền, không khôi phục hàng thống kê cũ |
| Cá nhân | Nhóm thông tin mở | Theme/tài khoản ưu tiên, nhóm thông tin có summary và mở đầy đủ |
| Hợp đồng cư dân | Tài liệu mở, bản trắng A4 | Tóm tắt người thuê/phòng trước; chọn/mở tài liệu; chỉ vùng tài liệu có cuộn ngang khi cần, không cả trang; in tự mở tài liệu |
| Thanh toán | QR + thông tin tài khoản | Số tiền/kỳ/hạn trước QR; thông tin chuyển khoản mở rộng; giá trị copy là nút có tên, hỗ trợ bàn phím và báo lỗi |
| Giặt sấy | Chọn máy/đặt lịch/bảng giá | Stats gọn, tab44px, form ngày/giờ một cột khi hẹp, label liên kết field; không nhấp nháy chấm trạng thái liên tục |
| Dashboard quản trị | Đầy đủ KPI/biểu đồ | Doanh thu và nút tác vụ trước; KPI/biểu đồ mở thêm, không bỏ dữ liệu |
| Phòng/thu tiền | Danh sách, tìm/lọc | Tìm phòng/khách và lọc trạng thái; card hành động rõ; khoản phí mở chi tiết |
| Điện nước quản trị | Bảng nhập số | Từng phòng, bốn ô nhập có nhãn trong lưới2×2 |
| Khai báo/hợp đồng/cấu hình | Giữ dữ liệu/bản in | Nhóm nhập xếp dọc, CCCD không tràn, control/form chạm thuận tiện |
| Điều hướng quản trị | Sidebar nổi,260/105px | Dock nổi4 tác vụ + trạng thái cổng thanh toán riêng; safe area, không che cuối nội dung |
| Dialog | Panel tác vụ giữa màn hình | Sheet sát đáy ở <640px, giới hạn theo visualViewport và safe area, cuộn trong |

Mốc bố cục chính: <640px form/sheet một cột; <768px quản trị ưu tiên tóm tắt; <1024px dùng dock thay sidebar; ≥1024px desktop. Nội dung không phụ thuộc hover. Disclosure dùng summary/nút có trạng thái, không ẩn chức năng vĩnh viễn. Thu phóng/đổi kích thước vẫn có thể mở/đóng nội dung thủ công.

## Chuyển động và phản hồi

| Tương tác | Duration | Quy tắc |
| --- | --- | --- |
| Nhấn/hover/chuyển màu control | 120ms | `--motion-fast` |
| Mũi tên disclosure/selected | 180ms | `--motion-standard` |
| Sidebar đổi độ rộng | 220ms | Không áp blur/opacity animation |
| Thông báo kết quả/tiêu đề dialog | 160ms | Opacity + translate3px trên nội dung, không trên lớp kính |
| Đổi trang/tab/mặt kính | Tức thì | Không fade/transform card hoặc ancestor có backdrop-filter; tránh hiện nền rõ rồi mờ lại |
| Spinner | 700ms linear | Chỉ khi tác vụ đang chạy |

Easing dùng `cubic-bezier(.2,.8,.2,1)` qua `--motion-ease`. Không animate blur/wallpaper, không bounce trang trí. Payment/Laundry không còn phụ thuộc Framer Motion cho fade toàn màn hình. `prefers-reduced-motion` giảm chuyển động; `prefers-reduced-transparency` và trình duyệt thiếu backdrop-filter có nền đặc thay thế.

## Kiểm tra và giới hạn

Kiểm tra dùng Chromium và dữ liệu giả lập; mọi API/dịch vụ ngoài bị chặn hoặc thay response. Không ghi Google Sheets, thanh toán, Zalo hoặc dữ liệu người thuê thật để thử UI. Build trong bản sao tạm vì plugin build cập nhật `app-config.json`; không đưa đường dẫn build tạm vào cấu hình repository.

Kết quả đã thực hiện:

- `npm run lint`, production build và `git diff --check` đạt.
- Lượt tích hợp production:114 kiểm tra trang/login/theme/giấy hóa đơn,78 kiểm tra thanh toán/giặt sấy/keyboard/viewport thấp; viewport320/390/768/1024/1440px, sáng/tối; không có lỗi JavaScript chưa xử lý.
- Cư dân:132 kiểm tra bố cục/disclosure/tài liệu;36 kiểm tra lọc/phân trang/focus và2 kiểm tra sheet trong viewport thấp.
- Quản trị:136 kiểm tra tác vụ/responsive,4 kiểm tra lỗi-thử lại/dữ liệu rỗng,2 kiểm tra bản in. Lỗi tràn CCCD320px đã được sửa.
- Dialog:272 kiểm tra geometry/focus/Tab/Escape/nền tài liệu và5 kiểm tra không gian thấp mô phỏng bàn phím.
- Clipboard:34 kiểm tra Enter/Space/thành công/từ chối quyền ở Payment/Laundry; lỗi hiện cho cả desktop/mobile/cổng đóng.
- Chuyển25mục liên tục với CPU giả lập chậm4×, đạt lượt kiểm tra prefetch/dữ liệu mới/logo; đây không phải phép đo FPS.16 kiểm tra tảiSVG/viewport cuối cùng, kèm8 ảnh chụp desktop/mobile ở cả hai theme.
- Kiểm tra biểu đồ dữ liệu rỗng/thiếu kỳ, giá trị thật và lựa chọn kỳ bằng bàn phím; số dự phòng minh họa cũ đã được bỏ, không ghi dữ liệu API.

Dung lượng bản build: **4.118.172 byte (~4,12MB)** tổng frontend, không tính manifest đo; JavaScript trang chủ **684.000byte (~0,68MB)**, tổng gzip riêng các gói **200.980byte (~0,20MB)**. Bộ79SVG (50 artwork được gửi +29ký hiệu dịch vụ bổ sung) tổng419.561byte; tải theo sử dụng, không nạp tất cả. Đã bỏ dependency runtime Framer Motion trong Payment/Laundry để tránh fade/compositing toàn khối; các dependency khác không bị thay đổi.

Các bộ kiểm tra có phạm vi chồng nhau, không cộng lại thành số màn hình độc lập. Các kiểm tra trình duyệt không chứng nhận FPS trên mọi điện thoại, bàn phím ảo iOS thật, quét QR thực tế hoặc độ sẵn sàng của Render/Google Sheets. Website mô phỏng vật liệu bằng CSS, không tái tạo shader kính native của Apple.
