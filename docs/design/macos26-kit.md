# macOS 26 kit → Trọ-Hub

## Nguồn đã đối chiếu

- [macOS 26 Community, node 483-8848](https://www.figma.com/design/5VaXU6kRUiGTIgEa7hMODo/macOS-26--Community-?node-id=483-8848), link và iframe người dùng gửi.
- Hai SVG `Materials - Light.svg` / `Materials - Dark.svg`, chứa wallpaper gốc cùng năm cột minh họa vật liệu.
- Hai file CSS `Pasted text.txt` gửi kèm. Chúng giống nhau và giống bản CSS trước đó: SHA-256 `2e0d66938c0ce2521c630ad8c9362356dc5740b62a01115af4493d741673a8fc`.
- Các hình typography Light/Dark/Vibrant và mẫu Liquid Glass small/medium/large người dùng gửi trong hội thoại.

Figma vẫn chưa truy cập được từ môi trường này. Các thay đổi được đối chiếu trực tiếp với SVG, CSS và hình ảnh đính kèm; không tuyên bố khớp từng pixel với canvas Figma hoặc tái tạo shader kính native của Apple.

## Wallpaper đúng từ file mới

SVG là **bảng minh họa**, không phải một wallpaper thuần: ngoài ảnh còn có chữ, năm panel và `foreignObject` mô tả blur. Dùng cả SVG làm background sẽ đặt các cột/chữ minh họa lên giao diện và tải hơn 15 MB.

Ảnh PNG nhúng trong mỗi SVG đã được tách ra, giữ nguyên **3024 × 1964px**, mã hóa WebP quality 94/method 6. Không vẽ lại, đổi màu hay làm mờ file ảnh. WebP là nén có mất dữ liệu; [nguồn, hash và số đo](../../public/backgrounds/README.md) ghi rõ để đối chiếu.

| Theme | PNG nhúng | WebP phát hành | Hiển thị |
| --- | ---: | ---: | --- |
| Light | 5.810.924 byte | 170.874 byte | `macos26-light.webp` |
| Dark | 5.558.619 byte | 158.144 byte | `macos26-dark.webp` |

Hai WebP tổng cộng **329.018 byte**, giảm khoảng **97,1%** so với PNG nhúng và **97,8%** so với toàn bộ SVG. Chỉ ảnh của theme đang dùng được tải khi mở trang; ảnh còn lại chỉ tải khi đổi theme. Không đưa các ảnh bảng typography hoặc dải màu thử nghiệm vào wallpaper.

Giữ opacity **90%** theo yêu cầu trước đó. Ảnh tràn màn hình bằng `object-fit: cover`, căn giữa; bỏ `scale(1.08)` vốn chỉ phục vụ cắt khung SVG cũ. Chế độ sáng/tối/tự động dùng chung `ThemeContext`; trên trình duyệt thường, theme được áp trước lần vẽ đầu để hạn chế lóe sáng khi tải lại.

## Typography từ bảng tham chiếu

Font stack dùng SF trên thiết bị Apple khi hệ thống cung cấp, có fallback hệ thống trên Windows/Linux/Android. Không tải hoặc phân phối lại font SF Pro. Số tiền/đồng hồ dùng chữ số tabular để tránh đổi độ rộng khi cập nhật.

| Vai trò | Desktop | Mobile | Áp dụng |
| --- | ---: | ---: | --- |
| Large Title | 26px / 32px | 26px / 32px | Tiêu đề trang |
| Title 1 | 22px / 26px | 22px / 26px | Danh tính, thông báo kết quả |
| Title 2 | 17px / 22px | 17px / 22px | Tiêu đề panel |
| Title 3 | 15px / 20px | 15px / 20px | Tiêu đề nhóm nhỏ |
| Headline | 13px / 18px, 600 | 14px / 20px, 600 | Nhãn quan trọng |
| Body | 13px / 18px | 15px / 22px | Nội dung |
| Callout | 12px / 16px | 13px / 18px | Mô tả bổ sung |
| Subheadline | 11px / 15px | 12px / 17px | Ngữ cảnh phụ |
| Footnote | 10px / 14px | 11px / 16px | Ghi chú không thiết yếu |
| Caption 1 / 2 | 10px / 14px | 11px / 16px | Ngữ cảnh ngắn |
| Control / trường nhập | 17px / 22px | 17px / 22px | Nút chính và form |

Các khoảng dòng và mức tăng trên mobile là điều chỉnh cho văn bản tiếng Việt, khả năng đọc và tránh zoom khi focus input trên iOS; không sao chép kích thước canvas tuyệt đối. Primary dành cho tiêu đề/dữ liệu, secondary dành cho mô tả/nhãn, tertiary chỉ dùng cho ngữ cảnh tùy chọn. Không dùng tertiary cho hạn nộp, số tiền hoặc hướng dẫn thao tác quan trọng.

Role classes và trọng lượng chữ nằm tại `src/styles/apple-typography.css`. `.kit-page-*` ánh xạ sang cùng hệ token, tránh nhiều kiểu tiêu đề/ngẫu nhiên theo từng trang.

## Vật liệu và hiệu ứng quang học

Thông số dưới đây ghi lại **kit nguồn**. Các giá trị áp dụng mới, khác biệt có chủ đích theo yêu cầu tăng độ trong và bố cục tác vụ mobile, nằm trong [đặc tả Tahoe](tahoe-upgrade.md).

| Material từ export | Light, `rgb(246,246,246)` | Dark, `rgb(0,0,0)` | Áp dụng |
| --- | ---: | ---: | --- |
| Ultra Thin | 36% | 10% | Toolbar, track chọn chế độ |
| Thin | 48% | 20% | Sidebar, dock |
| Medium | 60% | 29% | Panel nội dung |
| Thick | 72% | 40% | Cửa sổ đăng nhập sáng |
| Ultra Thick | 84% | 50% | Dialog/popover, đăng nhập tối |

- Blur **15px** lấy từ nhóm Materials. Khung lớn/vừa bo **34px**, bóng `0 8px 40px rgba(0,0,0,0.12)` theo mẫu Liquid Glass. Nhóm con 20px và field 12px là điều chỉnh theo mật độ của ứng dụng.
- Surface lớn, chrome điều hướng và control có fill riêng. Thêm phản sáng có hướng, rim trên và tiếp xúc dưới bằng gradient/inset shadow, thay cho viền trắng đều ở mọi phía.
- Mẫu dải màu trong kit dùng để quan sát kính trên nhiều nền; màu xanh tint của mẫu không trở thành màu chủ đạo ứng dụng. Giữ nút/chữ/viền đen trắng, logo Zalo và bộ icon 3D gốc có màu; màu cảnh báo/thành công giữ ý nghĩa riêng.
- Lớp sheen/opacity chỉ nằm trên background. Không đặt opacity lên parent khiến chữ và icon mờ theo; không dùng filter xám hoặc blend mode trên toàn bộ app.
- Không dùng SVG displacement, shader, animate blur hoặc di chuyển wallpaper. Các nhóm con/nút kế thừa kính của parent, không thêm backdrop filter chồng lớp.

## Độ rõ của chữ trên wallpaper mới

Cập nhật theo yêu cầu mới: bỏ lớp đọc phủ toàn màn hình ở cả cư dân và quản trị. Wallpaper giữ opacity90%; nền đọc chỉ nằm trên panel, tiêu đề và control. Bản Tahoe hiện dùng tint24%/blur12px cho card; vùng đọc/form có backing riêng. Các số đo lớp phủ dưới đây ghi lại phân tích phiên bản trước và không còn đại diện cho nền trống ở bản hiện tại.

Wallpaper mới có độ sáng thay đổi lớn. Chỉ dùng Thin/Ultra Thin trực tiếp trên ảnh có thể làm chữ secondary khó đọc. Vì vậy có lớp đọc phía dưới các material: Light `rgba(246,246,246,.68)`, Dark `rgba(0,0,0,.50)`, áp dụng cả desktop/mobile và trang quản trị. Chữ không bị filter; màu secondary sáng là `#3a3a3c`, tối `#e5e5e7`.

Mô hình kiểm tra lấy **92.988 mẫu pixel mỗi ảnh WebP** (bước 8px), composite sRGB với wallpaper 90% trên nền `#fafafa`/`#050505`, sau đó tính relative luminance:

| Nền theo mô hình | Primary tối thiểu | Secondary tối thiểu |
| --- | ---: | ---: |
| Light, lớp đọc riêng | 8,03:1 | 5,42:1 |
| Light + Medium | 12,18:1 | 8,21:1 |
| Dark, lớp đọc riêng | 6,82:1 | 5,42:1 |
| Dark + Medium | 10,30:1 | 8,19:1 |

Đây là mô hình trên mẫu ảnh, trước blur/antialias của trình duyệt, không phải chứng nhận WCAG cho toàn bộ giao diện hoặc phép đo từng glyph. Các screenshot sáng/tối và trạng thái thực tế được kiểm tra thêm trong Chromium. Login có fill riêng đủ đậm; QR, chi tiết hóa đơn và văn bản A4 tiếp tục trắng đặc.

## Template, khả năng dùng và hiệu năng

- Desktop dùng bố cục mở, không còn khung cửa sổ/viền/bóng bo quanh toàn bộ trang. Sidebar nổi riêng cách mép 16px, rộng 260/105px như admin; nút tròn chevron ở giữa cạnh phải, không cuộn theo nội dung và không bị panel cắt. Toolbar căn cùng nội dung, không tạo thanh tiêu đề cửa sổ. Mobile giữ dock năm mục; không sao chép tọa độ tuyệt đối từ Figma.
- Form đăng nhập hiển thị phone/password và nút Đăng nhập trước; Zalo đặt phía dưới, ngoài form để không kích hoạt submit thường.
- Checkbox/switch có vùng bấm ít nhất 44px, bề mặt gọn theo kit. Checkbox nhận tên từ nhãn, hỗ trợ click nhãn và Space.
- Popover thông báo cuộn theo chiều cao màn hình; nút đóng/đọc tất cả 44px. Thứ tự lớp: dock 30, toolbar 40, dialog 50.
- Đồng hồ máy giặt co theo khung, form ngày/giờ xếp dọc khi cần ở 320px; QR/placeholder giữ nền trắng, chữ tối.
- Giữ chia gói trang, tải trước khi rảnh, PDF chỉ tải khi xuất và tối ưu polling. Không chuyển động toàn bộ trang cư dân khi đổi mục.
- `prefers-reduced-motion` áp dụng cho CSS và các transition trạng thái Payment/Laundry. `prefers-reduced-transparency` và trình duyệt thiếu backdrop-filter dùng vật liệu/lớp đọc đặc.
- Khi in, ẩn chrome/window plane để giữ tài liệu A4.

## Kiểm tra

TypeScript, production build và cấu hình entry Zalo được kiểm tra. Browser dùng dữ liệu cư dân/máy giặt/thanh toán mô phỏng và chặn API/dịch vụ bên ngoài: không đọc/ghi dữ liệu production để thử giao diện.

Đã kiểm tra 320/390/768/1024/1440px, cả sáng/tối, đăng nhập/đăng ký, trang cư dân, dialog trắng hóa đơn, quản trị; thêm timer/đặt lịch giặt, thanh toán hoàn tất/cổng đóng, popup 12 thông báo trên 320×568px, nhãn/phím Space, fallback giảm độ trong suốt, in và sidebar thu gọn. Chuyển 25 mục liên tục với CPU giả lập chậm 4× không phát sinh lỗi JavaScript trong lượt kiểm tra. Các kiểm tra này không xác nhận FPS trên mọi thiết bị hay tốc độ API/Google Sheets/Render production.
