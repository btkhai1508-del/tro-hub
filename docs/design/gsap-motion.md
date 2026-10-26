# Animation GSAP — không đổi layout

Áp dụng trên bản GitHub `7a6ddff`. Không thay cấu trúc, khoảng cách, màu, kích thước card, điều hướng hoặc handler nghiệp vụ.

- CDN: `https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js`, tải async trong `index.html`. Không cài dependency npm, không dùng ScrollTrigger.
- Bộ điều khiển: `src/lib/uiMotion.ts`, khởi tạo một lần ở `main.tsx`, dọn listener/observer khi HMR dispose.
- Tiêu đề trang hoặc dialog mới: opacity0→1, y4→0,160ms, `power2.out`.
- Nhấn nội dung bên trong nút: scale0.97 trong80ms, thả về1 trong120ms. Không scale chính card/nút có kính. Pointer cancel/mất focus trả trạng thái về bình thường.
- Tab được chọn: icon/nội dung lá phản hồi opacity0.6→1 trong120ms. Tiêu đề thay đổi được nhận biết cả khi React cập nhật text node.
- Tick copy thành công: scale0.85→1, opacity0.5→1,120ms. Gắn marker không thay markup/handler clipboard.
- Khung kính và ancestor chứa kính không nhận opacity/transform animation; chỉ heading hoặc nội dung lá đủ điều kiện mới được chạy. Tài liệu trắng/invoice/A4 và spinner được bỏ qua.
- Đóng popup vẫn diễn ra ngay theo handler hiện có, không trì hoãn để đợi hiệu ứng. Giữ spinner/loading CSS hiện có.
- Không ghi đè transform/opacity gốc sau hiệu ứng; khôi phục cả SVG transform/data-svg-origin. Tween cũ bị hủy trước khi chạy hiệu ứng mới; node tháo khỏi DOM được dọn.
- `prefers-reduced-motion: reduce` chặn GSAP và hủy ngay hiệu ứng đang chạy. CDN lỗi/chậm không ẩn nội dung hoặc chặn thao tác. Không đặt opacity0 mặc định trong CSS.

Kiểm tra trên production build bằng Chromium với API giả lập: **58 kiểm tra tương tác/layout/fallback và 11 kiểm tra tick/CDN chậm đều đạt**. TypeScript/build/diff-check; viewport390/1440 sáng/tối, CDN thật được lấy về dùng trong fixture, chặn CDN, nhấn giữ/thả/lặp, đổi mục nhanh, mở dialog, đổi trạng thái giảm chuyển động, so sánh chính xác bounding box và chiều dài trang khi bật/tắt GSAP. Không kiểm tra Safari/iPhone thật hoặc tốc độ CDN trên mạng người dùng.
