# Tham chiếu giao diện Trọ-Hub

## Nền do người dùng cung cấp

- Mẫu chọn: **Gradient Background #4**.
- Sáng: `public/backgrounds/gradient-04-light.svg` — file gốc `Gradient Background #4.svg`.
- Tối: `public/backgrounds/gradient-04-dark.svg` — file gốc `Gradient Background #4-1.svg`.
- Cả hai giữ `opacity: 0.90`. CSS phóng nhẹ để cắt khung trình bày của SVG, dùng gradient tràn màn hình.
- Đổi ảnh theo class `.dark` của ứng dụng, kể cả khi người dùng đổi chế độ thủ công.

## Vật liệu và nội dung

- Kính trong: lớp trắng 20% ở chế độ sáng, lớp đen 20% ở chế độ tối; thẻ phụ 12%.
- Kính có `backdrop-filter: blur(20px) saturate(125%)`, viền phản sáng mảnh và bóng nhẹ. Không dùng filter xám hoặc opacity trên toàn trang/nội dung.
- Chữ chính đen/trắng, chữ phụ tương phản cao; nút chính vẫn đen/trắng.
- Giữ nguyên hình và màu bộ icon 3D. Màu cảnh báo/trạng thái có ý nghĩa được giữ riêng.
- Font hệ thống Apple trên thiết bị Apple, có fallback hệ thống trên thiết bị khác.
- Bỏ cột quảng bá “Về nhà. Thật nhẹ nhàng.” và hai thẻ giới thiệu; form đăng nhập căn giữa.
- Có vật liệu đặc thay thế khi trình duyệt không hỗ trợ blur hoặc người dùng yêu cầu giảm độ trong suốt; văn bản pháp lý/QR giữ nền dễ đọc, dễ quét.

## Hóa đơn, tải trang và chuyển động

- Bảng chi tiết hóa đơn là nền trắng đặc, chữ tối ở cả chế độ sáng và tối.
- Bỏ hàng thống kê Tất cả / Đã thanh toán / Chờ xác nhận.
- Trang được tách thành các gói tải theo nhu cầu; thư viện PDF/ảnh chụp chỉ tải khi bấm xuất.
- Chuyển trang 240ms, mở bảng 200ms; có spinner/skeleton và tôn trọng giảm chuyển động.
- Khi chuyển trang chậm, giữ header/menu và hiển thị trạng thái tải.

## Dung lượng đo trên bản build

- Tổng file frontend phát hành: khoảng **3,50 MB** (không tính manifest dùng để đo).
- JavaScript mở trang chủ: **0,71 MB**, so với gói ban đầu **1,79 MB**, giảm khoảng **60%**.
- JavaScript trang chủ sau nén gzip: khoảng **0,20–0,21 MB**; số truyền thực tế phụ thuộc cấu hình nén của hosting.
- Đây là số đo file build; thời gian phản hồi API/Google Sheets hoặc khởi động Render cần đo riêng.
