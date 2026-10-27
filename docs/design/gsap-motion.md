# Motion Trọ-Hub — Brand Morph

Thiết kế lại hệ motion theo yêu cầu: giữ bố cục và nghiệp vụ hiện có, tập trung intro thương hiệu; đổi mục chỉ fade-out rồi fade-in; sidebar thu/mở nhẹ. Thay bộ hiệu ứng cũ, không chạy hai hệ song song.

## Intro đăng nhập

Dùng đúng Home asset, tên Trọ-Hub và phụ đề đang có trong header. Một bản sao trang trí, `aria-hidden`, không bắt pointer, nằm ngoài cây layout của ứng dụng. Header thật giữ nguyên kích thước/vị trí. Đo vùng thương hiệu thực tế, đưa bản sao tới giữa viewport rồi dùng transform đưa về đúng vùng đó; không dùng tọa độ cố định cho đích.

| Nhịp | Thời điểm bắt đầu | Thời lượng | Easing |
| --- | ---: | ---: | --- |
| Logo hiện từ scale .76, nghiêng −7°, y8px | 80ms | 460ms | expo.out |
| Tên thương hiệu từ x12px, opacity0 | 180ms | 360ms | power3.out |
| Phụ đề từ y4px, opacity0 | 320ms | 280ms | sine.out |
| Ánh sáng trung tính phía sau xuất hiện, rồi tan | 80 / 620ms | 500 / 400ms | sine.out / sine.in |
| Lộ wallpaper và card thật | 760ms | 560ms | power2.inOut |
| Cả cụm thu về header | 760ms | 720ms | power3.inOut |

Tổng 1,48 giây sau khi sẵn sàng. Scale tối đa2.6, giới hạn theo chiều rộng viewport. Chỉ phát một lần trong mỗi document: tải lại/mở tab mới sẽ phát lại; đổi đăng nhập/đăng ký trong cùng trang không phát lại.

Chạm, bàn phím, focus vào field, cuộn, resize, bàn phím ảo đổi viewport, chuyển tab, in hoặc bật giảm chuyển động đều hủy ngay và khôi phục header. Không đặt nội dung thật opacity0 trong CSS mặc định. Nếu GSAP hoặc logo chưa sẵn sàng trong600ms thì bỏ qua; failsafe1750ms dọn overlay nếu có sự cố.

## Hệ tương tác dùng chung

| Thành phần / tác vụ | Motion mới | Thời lượng |
| --- | --- | ---: |
| Chuyển trang cư dân | Giữ màn cũ để fade-out; sau đó render màn mới và fade-in. Không dịch chuyển/card stagger khi đổi trang | 100 + 160ms |
| Chuyển mục admin | Cùng nhịp với cư dân, áp dụng cho state menu nội bộ | 100 + 160ms |
| Sidebar hai vai trò | Độ rộng, phần bù nội dung và padding nội bộ cùng easing cubic-bezier(.2,.7,.2,1) | 240ms |
| Nhấn/thả nút | Chỉ nội dung lá an toàn co .985 rồi hồi1; không scale khung kính | 80 / 120ms |
| Quick action và tiện ích admin | Icon3D nhấc3px, nghiêng−2°, scale1.035 khi hover/focus trên thiết bị có chuột; mũi tên2D dịch2px | 160–220ms |
| Dialog, disclosure, popover thông báo | Tối đa6 tiêu đề/nhãn/nội dung hiện từ y5px, opacity.65; lệch25ms | 200ms mỗi phần |
| Thông báo lỗi/thành công/toast | Text/icon hiện từ y4px, opacity.45; nền kính và vị trí cố định không bị transform | 180ms |
| Copy thành công | Tick nhỏ scale.8→1, opacity.3→1 | 180ms |
| Checkbox và nhánh thành công hiện có | Vẽ nét tick một lần; trạng thái nghiệp vụ thay đổi ngay | 350ms |
| Công tắc | Núm di chuyển theo checked thật, easing nhẹ | 180ms |
| Bộ lọc danh sách / xem thêm | Chỉ nhãn mới lộ ra, tối đa6; gom lượt gõ100ms. Không chạy lại danh sách khi gõ form khác | 200ms + nhịp25ms |
| Tiến độ thu phí | Phần fill chuyển từ tỷ lệ trước sang mới, gốc ở trái; số và ARIA cập nhật ngay | 300ms |
| Giá trị tiền/trạng thái thay đổi | Gạch nhấn mảnh xuất hiện rồi tan; không count-up số tiền | 450ms |
| Input invalid | Lắc nhẹ tối đa2px; không đổi focus/nội dung | 180ms |
| Biểu đồ khi mở chi tiết | Vẽ nét đường dữ liệu một lần nếu là SVG đủ điều kiện | 450ms |
| Loading / busy | Giữ spinner/skeleton phản ánh việc tải thật; nhãn đổi trạng thái phản hồi opacity | 120ms cho nhãn |

Nhấn liên tục hủy tween cũ; chọn nhiều mục liên tiếp luôn lấy mục cuối. Màn đang fade-out tạm inert để tránh thao tác lên dữ liệu cũ; điều hướng bên ngoài vẫn dùng được. Khi lazy chunk chưa tới, fallback tải trang vẫn hiện và không để panel bị opacity0. Đăng xuất/guard quyền nằm ngoài lớp chuyển cảnh nên có thể tháo màn ngay.

## Kiến trúc và giới hạn hiệu ứng

- GSAP3.13.0 qua CDN async trong `index.html`, không thêm dependency npm, video hay thư viện render vào bundle ứng dụng.
- `BrandIntro.tsx` + `brand-intro.css`: intro riêng biệt, dọn toàn bộ clone/listener/timer sau mỗi lượt.
- `FadeOutlet.tsx`: giữ outlet cũ để fade tuần tự. `useCrossfadeState.ts`: cùng cơ chế cho admin.
- `motionEngine.ts`: capability chung. `uiMotion.ts`: một observer đã giới hạn attribute và các listener dùng chung; rAF gộp mutation.
- `motion-system.css`: timing và phản hồi CSS. `data-stage` đánh dấu rõ vùng tiền, list, progress, copied, success và popover; bộ lọc trỏ đến đúng list bằng `data-stage-filter`.
- Xóa `uiMotionScenes.ts`, card light sweep, vệt chọn menu, stagger nhãn sidebar, animation tiêu đề toàn trang và các utility entrance cũ. Không thêm lại dưới tên khác.
- Khung kính popup/card không nhận transform/opacity riêng; chỉ nội dung lá an toàn được animate. Chuyển màn là fade wrapper theo yêu cầu riêng. Không tween blur, filter, màu wallpaper, kích thước card hoặc số tiền.
- Giấy hóa đơn/A4, spinner, vùng sr-only và phần tử có backdrop-filter được loại khỏi motion nội dung. SVG giữ lại transform/data-svg-origin gốc sau khi kết thúc.
- `prefers-reduced-motion`, tab ẩn, blur cửa sổ, in và HMR dọn tween/style tạm. Khi GSAP không tải, giao diện và thao tác vẫn hiện bình thường. CSS giảm chuyển động áp dụng cả transition cũ còn phục vụ trạng thái.

## Kiểm tra

Build production trong bản sao riêng vì plugin Vite Zalo ghi lại asset hash vào app-config.json. Không chạy backend hoặc ghi Google Sheets thật. Browser dùng API fixture và chặn các kết nối ngoài cần thiết; GSAP thật được lấy về làm fixture CDN.

Kết quả trên bản production tích hợp: **213 assertion Chromium đạt**, TypeScript và production build đạt, diff-check sạch.

- 49 kiểm tra intro:320/390/1440px sáng/tối; center, đích đến lệch dưới1px; reload, không phát lại khi đổi mode; ngắt bằng focus/pointer/resize/scroll/reduced-motion/in; CDN bị chặn/chậm1500ms và field vẫn nhập được.
- 33 kiểm tra route cư dân: giữ DOM cũ trong fade-out; same-path không remount; 12 lần đổi mục nhanh; giảm chuyển động giữa fade; CDN lỗi; lazy Profile chunk chậm; đăng xuất tháo outlet ngay.
- 38 kiểm tra admin:390/1440px sáng/tối; giữ màn cũ; lựa chọn cuối thắng; hủy yêu cầu bằng mục hiện tại; reduced-motion giữa fade; CDN lỗi; thu/mở sidebar8lần về đúng kích thước; không tràn ngang.
- 93 kiểm tra phản hồi: popup thông báo và modal hồ sơ thật; fixture DOM riêng cho toast/copy/success, bộ lọc chỉ chạy trên hàng mới, gõ form khác không replay list, progress giữ gốc trái/ARIA thật, SVG khôi phục sau nhấn/thả và ngắt bằng reduced-motion; không tween host có blur, không lỗi JavaScript.

Các kiểm tra motion/data fixture không chứng minh giao dịch, Zalo OAuth, Google Sheets hoặc tốc độ mạng người dùng thực tế. Chưa kiểm tra Safari/iPhone thật hoặc trạng thái deploy Render.
