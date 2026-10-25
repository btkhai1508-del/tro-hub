# Tham chiếu giao diện Trọ-Hub

## Nền do người dùng cung cấp

- Mẫu chọn: **Gradient Background #4**.
- Sáng: `public/backgrounds/gradient-04-light.svg` — file gốc `Gradient Background #4.svg`.
- Tối: `public/backgrounds/gradient-04-dark.svg` — file gốc `Gradient Background #4-1.svg`.
- Cả hai giữ `opacity: 0.90`. CSS phóng nhẹ để cắt khung trình bày của SVG, dùng gradient tràn màn hình.
- Đổi ảnh theo class `.dark` của ứng dụng, kể cả khi người dùng đổi chế độ thủ công.

## Vật liệu và nội dung

- Kính trong: lớp trắng 20% ở chế độ sáng, lớp đen 20% ở chế độ tối; thẻ phụ 12%.
- Kính có `backdrop-filter: blur(12px) saturate(125%)`, viền phản sáng mảnh và bóng nhẹ. Không dùng filter xám hoặc opacity trên toàn trang/nội dung.
- Chữ chính đen/trắng, chữ phụ tương phản cao; nút chính vẫn đen/trắng.
- Giữ nguyên hình và màu bộ icon 3D. Màu cảnh báo/trạng thái có ý nghĩa được giữ riêng.
- Font hệ thống Apple trên thiết bị Apple, có fallback hệ thống trên thiết bị khác.
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
- JavaScript mở trang chủ: **0,71 MB**, so với gói ban đầu **1,79 MB**, giảm khoảng **60%**.
- JavaScript trang chủ sau nén gzip: khoảng **0,20–0,21 MB**; số truyền thực tế phụ thuộc cấu hình nén của hosting.
- Đây là số đo file build; thời gian phản hồi API/Google Sheets hoặc khởi động Render cần đo riêng.

## Chuyển mục nhanh

- Các mục cư dân được nạp trước tuần tự khi trình duyệt rảnh; bỏ qua nạp trước tự động trên kết nối 2G/tiết kiệm dữ liệu. Không nạp trước quản trị/PDF.
- Di chuột, focus hoặc chạm menu sẽ ưu tiên tải mục sắp mở. Không giữ các trang ẩn cùng chạy.
- Chỉ lớp kính chính dùng blur; ô kính phụ/nút không tạo lớp blur chồng nhau. Nền giữ opacity 90%, icon 3D không đổi.
- Polling gộp yêu cầu đang chạy, bỏ qua dữ liệu không đổi và tạm dừng polling nền khi tab ẩn.
- Hướng dẫn tự hiện một lần cho mỗi cư dân trên thiết bị; có thể mở lại trong Tiện ích. Đóng hướng dẫn không ép về Trang chủ.
- Nút Zalo dùng logo gốc lưu local tại `public/brand/zalo-logo.png`.
