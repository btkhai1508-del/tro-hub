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

## Điểm nhấn cho card và sidebar

- Card chi phí/phòng, quick action, doanh thu và phòng admin: dải sáng trắng mảnh lướt550ms khi hover bằng chuột, focus bàn phím hoặc chạm. Chỉ animate biến CSS của gradient trang trí `::after`; không di chuyển card hoặc thay blur. Không chạy nền liên tục, không xử lý pointermove.
- Mở sidebar user/admin: nhãn menu đi từ trái8px, opacity0→1 trong220ms; lệch nhau25ms, tối đa125ms. Giữ nguyên hiệu ứng độ rộng/layout có sẵn. Mở/đóng liên tiếp hủy tween cũ và khôi phục style.
- Lớp sáng bỏ qua pointer để không chặn nút. Tắt và dọn ngay khi bật giảm chuyển động, tab bị ẩn hoặc node bị tháo khỏi DOM; không chạy khi CDN chưa sẵn sàng.

## Phản hồi tác vụ trên toàn website

Bộ cảnh dùng chung nằm tại `src/lib/uiMotionScenes.ts`, được nối vào observer hiện có thay vì tạo một observer toàn trang thứ hai. Bổ sung marker không đổi layout, màu, dữ liệu hoặc handler nghiệp vụ.

| Cảnh | Áp dụng | Chuyển động |
| --- | --- | --- |
| Chọn mục | Sidebar, bottom bar, segmented tab | Viền chọn di chuyển giữa hai mục220ms; vị trí/selected thật đổi ngay. Lớp tuyệt đối không bắt pointer và tự xóa |
| Mở chi tiết | Native details, disclosure admin, body dialog | Chữ/nhãn xuất hiện từ dưới3px,160ms; lệch15ms, tối đa8 phần tử mỗi nhóm |
| Danh sách | Phòng admin, lịch sử hóa đơn, tiện ích, danh sách máy | Nhãn kết quả hiện theo nhịp khi DOM danh sách thay đổi; không fade nguyên card kính |
| Cập nhật dữ liệu | Chi phí trang chủ, tổng hóa đơn, doanh thu admin, trạng thái máy | Viền sáng450ms khi giá trị khác lần trước; không count-up số tiền. Không kích hoạt lần mount đầu hoặc khi dữ liệu không đổi |
| Tiến độ thu tiền | Dashboard admin | Scale phần fill từ mức cũ sang mới300ms; aria-valuenow và phần trăm hiển thị đúng giá trị mới ngay. Không tạo dữ liệu hay ghi API |
| Công tắc | AppleSwitch ở các màn hình đang dùng | Núm co ngang90%→100% trong180ms; giữ chuyển động translate và checked/handler hiện có |
| Thành công | Payment/Laundry ở nhánh success hiện có | Tick xuất hiện200ms và vòng sáng mảnh320ms, một lần khi nhánh đó được mount; không tự xác nhận thanh toán |
| Lỗi | Alert và input invalid | Thông báo hiện160ms; trường invalid lắc tối đa2px/180ms, giữ focus và nội dung |
| Đang xử lý | Nhãn nút có nội dung Đang/Đã lưu/Đã gửi/Đã cập nhật | Opacity nhãn0.6→1 trong120ms; spinner, disabled và thời điểm hoàn thành do nghiệp vụ hiện có quyết định |

Số tiền, mã, dữ liệu `.font-num`, giấy A4/chi tiết hóa đơn không bị làm mờ theo danh sách. Đọc trạng thái máy qua `data-motion-value` để thay đổi số phút còn lại không kích hoạt viền. Hiệu ứng card cập nhật dữ liệu ưu tiên hơn ánh sáng hover trên cùng card.

Các cảnh không dùng animation vô hạn. Callback không trì hoãn đổi trang/lưu/đóng dialog. Tween cũ bị dọn trước lượt mới; layer, frame và tham chiếu navigation được dọn khi node unmount. `beforeprint`, tab ẩn, giảm chuyển động và HMR đều dọn hiệu ứng. CDN không tải được vẫn có UI đầy đủ, không có opacity0 mặc định.

Kiểm tra production build bằng Chromium, API giả lập:36 kiểm tra cảnh trên390/1440px sáng/tối;13 kiểm tra bổ sung cho trạng thái máy/đồng hồ, nội dung dialog, busy/error, in, CDN bị chặn và đổi mục liên tục. Kiểm tra lại58 trường hợp GSAP/fallback/layout và15 trường hợp card/sidebar trước đó. Các phép thử điều khiển DOM để cô lập hiệu ứng không phải kiểm tra thanh toán hay Google Sheets thật; chưa thử Safari/iPhone thật.
