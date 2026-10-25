# macOS 26 kit → Trọ-Hub

Nguồn tham chiếu: file CSS `Pasted text.txt` người dùng gửi ngày 25/10/2026 và [macOS 26 Community trên Figma](https://www.figma.com/design/5VaXU6kRUiGTIgEa7hMODo/macOS-26--Community-?node-id=0-962).

Link Figma chưa truy cập được từ môi trường triển khai thay đổi này; thông số dưới đây được đối chiếu với CSS đính kèm. Đây là cách áp dụng kit vào sản phẩm responsive, không phải bản xác nhận khớp từng pixel với canvas Figma.

## Vật liệu từ export

| Material | Sáng (`rgb(246,246,246)`) | Tối (`rgb(0,0,0)`) | Áp dụng |
| --- | --- | --- | --- |
| Ultra Thin | 36% | 10% | Toolbar, nền khung cửa sổ, track chọn chế độ |
| Thin | 48% | 20% | Sidebar, dock mobile |
| Medium | 60% | 29% | Panel nội dung |
| Thick | 72% | 40% | Cửa sổ đăng nhập |
| Ultra Thick | 84% | 50% | Dialog và thông báo nổi |

- Blur **15px** lấy từ các mẫu Materials. Bán kính **34px** và bóng `0 8px 40px rgba(0,0,0,0.12)` lấy từ các mẫu Liquid Glass lớn/vừa.
- Thẻ con bo 20px và control bo 12px là điều chỉnh theo mật độ thông tin của Trọ-Hub. Các nút hành động dùng dạng capsule, vùng chạm tối thiểu 44px.
- Không sao chép tọa độ tuyệt đối của canvas Figma. Các template dùng grid/flex để co giãn từ 320px.
- Không dùng các lớp màu xám/blend mode để lọc toàn bộ nội dung. Opacity nằm trên màu nền; chữ, logo và icon giữ opacity 1.
- Mẫu chữ `SF Pro`, nhãn 13px và UI 17px được chuyển sang stack font Apple có sẵn trên thiết bị, không tải font từ bên ngoài. Nội dung thông thường 15px/1.5; tiêu đề trang 26–32px.
- Chữ primary/secondary dùng màu tương phản rõ theo theme, không dùng mẫu chữ phụ `#7c7c7c` trên nền tối có wallpaper sáng phía sau.

## Template và wallpaper

- Desktop: khung cửa sổ có khoảng thở 16px, sidebar 232px (thu gọn 80px), toolbar 84px; nội dung cuộn tự nhiên.
- Mobile: toolbar 76px, nội dung một cột khi cần, dock nổi gồm năm mục cư dân.
- Shared classes tại `src/styles/macos-kit.css`; material/type tokens tại `src/index.css`.
- Wallpaper sử dụng **Gradient Background #4 / #4-1** do người dùng gửi trước đó, giữ file SVG gốc và opacity **90%** ở cả hai chế độ. CSS export mới chỉ có `url(image.png)`, không chứa tệp wallpaper mới để thay thế.
- Giữ bộ icon 3D có màu và logo Zalo gốc. Nút/chữ/viền sản phẩm dùng đen trắng; màu trạng thái cảnh báo/thành công giữ ý nghĩa riêng.
- Chi tiết hóa đơn, QR thanh toán và văn bản A4 tiếp tục dùng mặt giấy trắng, độc lập với theme.

## Giới hạn chi phí render

- Mỗi surface chính dùng một backdrop filter. Các nhóm con và control kế thừa nền kính của parent, không blur chồng lớp.
- Không animate transform/opacity của toàn bộ trang cư dân khi đổi mục. Giữ preload trang, chia gói PDF và tối ưu polling từ phiên bản trước.
- Overlay dialog chỉ dùng lớp màu tối; dialog dùng blur riêng. Menu nằm dưới overlay; khung cửa sổ không tạo stacking context bao toàn bộ dialog.
- Fallback đặc cho trình duyệt không hỗ trợ backdrop-filter và `prefers-reduced-transparency`; `prefers-reduced-motion` tắt animation/transition CSS.
- Khi in hợp đồng, ẩn toolbar/sidebar/dock và nền khung cửa sổ, giữ tài liệu A4.
