# Tham chiếu giao diện Trọ-Hub

## Nền do người dùng cung cấp

- Mẫu chọn: **Gradient Background #4**.
- Sáng: `public/backgrounds/gradient-04-light.svg` — file gốc `Gradient Background #4.svg`.
- Tối: `public/backgrounds/gradient-04-dark.svg` — file gốc `Gradient Background #4-1.svg`.
- Cả hai giữ `opacity: 0.90`. CSS phóng nhẹ để cắt khung trình bày của SVG, dùng gradient tràn màn hình.
- Đổi ảnh theo class `.dark` của ứng dụng, kể cả khi người dùng đổi chế độ thủ công.

## Vật liệu và nội dung

- Áp dụng vật liệu và template từ **macOS 26 Community UI kit** người dùng cung cấp; [bảng đối chiếu thông số và cách áp dụng](design/macos26-kit.md).
- Kính có năm mức Ultra Thin → Ultra Thick, sáng từ 36–84% và tối từ 10–50%, dùng `backdrop-filter: blur(15px)` theo export.
- Lớp phụ/ô nhập/nút không có blur riêng; viền phản sáng mảnh và bóng theo kit. Không dùng filter xám hoặc opacity trên toàn trang/nội dung.
- Chữ chính đen/trắng, chữ phụ tương phản cao; nút chính vẫn đen/trắng.
- Giữ nguyên hình và màu bộ icon 3D. Màu cảnh báo/trạng thái có ý nghĩa được giữ riêng.
- Font hệ thống Apple trên thiết bị Apple, có fallback hệ thống trên thiết bị khác. Chữ nội dung 15px, trường nhập 17px; tiêu đề trang 26–32px, nhãn 13px.
- Desktop dùng khung cửa sổ bo 34px, sidebar tích hợp và toolbar; mobile dùng toolbar gọn và dock nổi. Các nhóm nội dung con bo 20px.
- Form đăng nhập, danh sách hóa đơn, trang tiện ích/hồ sơ/hợp đồng/thanh toán/giặt sấy và các dialog cư dân dùng chung các kiểu template.
- Bỏ cột quảng bá “Về nhà. Thật nhẹ nhàng.” và hai thẻ giới thiệu; form đăng nhập căn giữa.
- Có vật liệu đặc thay thế khi trình duyệt không hỗ trợ blur hoặc người dùng yêu cầu giảm độ trong suốt; văn bản pháp lý/QR giữ nền dễ đọc, dễ quét.

## Hóa đơn, tải trang và chuyển động

- Bảng chi tiết hóa đơn là nền trắng đặc, chữ tối ở cả chế độ sáng và tối.
- Bỏ hàng thống kê Tất cả / Đã thanh toán / Chờ xác nhận.
- Trang được tách thành các gói tải theo nhu cầu; thư viện PDF/ảnh chụp chỉ tải khi bấm xuất.
- Không dịch chuyển cả trang khi đổi mục; chỉ giữ hiệu ứng nút và mở bảng 200ms, có spinner/skeleton và tôn trọng giảm chuyển động.
- Khi chuyển trang chậm, giữ header/menu và hiển thị trạng thái tải.

## Dung lượng đo trên bản build

- Tổng file frontend phát hành: khoảng **3,50 MB** (không tính manifest dùng để đo).
- JavaScript mở trang chủ: khoảng **0,72 MB**, so với gói ban đầu **1,79 MB**, giảm khoảng **60%**.
- JavaScript trang chủ sau nén gzip: khoảng **0,20–0,21 MB**; số truyền thực tế phụ thuộc cấu hình nén của hosting.
- Đây là số đo file build; thời gian phản hồi API/Google Sheets hoặc khởi động Render cần đo riêng.

## Chuyển mục nhanh

- Các mục cư dân được nạp trước tuần tự khi trình duyệt rảnh; bỏ qua nạp trước tự động trên kết nối 2G/tiết kiệm dữ liệu. Không nạp trước quản trị/PDF.
- Di chuột, focus hoặc chạm menu sẽ ưu tiên tải mục sắp mở. Không giữ các trang ẩn cùng chạy.
- Chỉ lớp kính chính dùng blur; ô kính phụ/nút không tạo lớp blur chồng nhau. Nền giữ opacity 90%, icon 3D không đổi.
- Polling gộp yêu cầu đang chạy, bỏ qua dữ liệu không đổi và tạm dừng polling nền khi tab ẩn.
- Hướng dẫn tự hiện một lần cho mỗi cư dân trên thiết bị; có thể mở lại trong Tiện ích. Đóng hướng dẫn không ép về Trang chủ.
- Nút Zalo dùng logo gốc lưu local tại `public/brand/zalo-logo.png`.
- Kiểm tra trình duyệt bằng dữ liệu mô phỏng, chặn toàn bộ API/dịch vụ bên ngoài: các trang ở 320/390/768/1024/1440px, sáng/tối; chuyển mục liên tục với CPU giả lập 4×; dialog, lớp phủ menu, sidebar thu gọn và bản in. Đây không phải phép đo tốc độ Google Sheets hay Render production.
