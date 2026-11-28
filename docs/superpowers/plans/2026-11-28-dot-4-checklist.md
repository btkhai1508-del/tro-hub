# Checklist kiểm tra Đợt 4 (chạy local)

## Đang chạy
- Giao diện: http://localhost:5299 (mở bằng trình duyệt thường cũng được)
- Worker local: http://localhost:8788 (D1 local, đã áp migration 0029; không đụng Cloudflare thật)
- Bridge mock: http://localhost:4200 (thay Express, chỉ để đăng nhập)
- Tắt/bật lại: Claude bật lại 3 server `worker-local`, `bridge-mock`, `dot4-ui` trong `.claude/launch.json`.

## Tài khoản thử (dữ liệu local, mật khẩu: `1`)
| Vai trò | SĐT | Thấy căn |
|---|---|---|
| Chủ trọ | 0902371800 | TRUNG_KIM, LVC, NT_THU, NTB |
| Quản lý Trung Kim | 0899510260 | chỉ TRUNG_KIM |
| Quản lý LVC | 0922222222 | chỉ LVC |

Ghi chú dữ liệu: tháng mặc định là **12/2026** (đang chuẩn bị tháng sau). Lúc thử, Claude đã tạo hoá đơn 12/2026 cho LVC-101, LVC-102; trả phòng LVC-104; đánh dấu đã đóng tháng 11 cho TK-102, 104, 105 và LVC-101.
Mỗi lần mở trang sẽ hiện popup "Đang chuẩn bị hoá đơn tháng 12/2026": bấm **Đã hiểu**.
Giao diện không tự cập nhật khi sửa code: báo Claude bật lại `dot4-ui`.

## 1. Phòng & Khách (giao diện cũ, có switch)
- [ ] Thẻ phòng như trước: số phòng, switch Đã đóng/Chưa đóng, số người. Không có bảng phí trên thẻ.
- [ ] Bấm số phòng → mở màn chi tiết phòng; màn này vẫn có switch ở góc trên.

## 2. Tab Hoá đơn
- [ ] Bảng không còn nút Tạo / Sửa; cột cuối là **Tình trạng** (phòng nháp ghi "Chưa tạo", không còn chữ "Nháp", phòng đã tạo bấm đổi Đã đóng ↔ Chưa đóng). Bảng không tràn ngang ở ~1280px.
- [ ] Điện thoại: trạng thái nằm ở đầu thẻ như trước; phần phí hiện sẵn, không gập.
- [ ] Bấm vào một phòng → màn chi tiết hoá đơn giống layout Hợp đồng: một card bên trái (chọn phòng, tháng ở trên; 4 nút **màu đen** ở dưới theo thứ tự Sao chép link thanh toán, **Sửa hoá đơn**, In, Lưu PDF), hoá đơn thu nhỏ vừa màn hình bên phải. Điện thoại: card ở trên, hoá đơn ở dưới.
- [ ] Bấm **Sửa hoá đơn** → mở màn chi tiết phòng của đúng phòng và tháng đó.

## 3. Chọn phòng rồi Tạo hoá đơn
- [ ] Cột ô chọn trước số phòng; ô "chọn tất cả" ở đầu bảng (điện thoại: dòng "Tất cả").
- [ ] Chưa chọn phòng nào: nút ghi "Tạo hoá đơn" kèm dòng "Vui lòng chọn phòng tạo hoá đơn"; bấm thì nhắc chọn phòng.
- [ ] Chọn 2 phòng → nút thành "Tạo 2 hoá đơn" → popup → tạo đúng 2 phòng, các phòng khác vẫn là nháp. (Tạo riêng 1 phòng: chọn đúng phòng đó.)
- [ ] Sau khi tạo, các ô đã chọn tự bỏ chọn.
- [ ] Phòng còn thiếu chỉ số điện nước: popup cảnh báo "chưa nhập chỉ số", nút "Vẫn tạo".

## 4. Tạo tất cả hoá đơn + thông báo cư dân
- [ ] Nút **Tạo tất cả hoá đơn** nằm dưới thanh tìm kiếm/bộ lọc, trên bảng, có số nháp.
- [ ] Bấm → tạo mọi phòng còn nháp (theo bộ lọc căn), toast "… và gửi thông báo thanh toán cho cư dân".
- [ ] Đăng nhập một cư dân của phòng vừa tạo → mục Thông báo có đúng **1** thông báo "Thông báo thanh toán tiền phòng tháng …" ghi tổng tiền phòng mình.
- [ ] Bấm "Tạo tất cả" lần nữa → báo đã tạo hết, cư dân không nhận thêm thông báo.

## 5. Đổi tháng / người ở ghép tháng sau
- [ ] Đổi sang tháng 11/2026 → danh sách hiện dữ liệu tháng 11 (trạng thái Đã đóng của các phòng đã đánh dấu), đổi lại 12 thì về tháng 12.
- [ ] (Đang trong 5 ngày cuối tháng) thêm một người ở ghép vào phòng trống → phòng có nháp cả tháng 11 lẫn tháng 12.
- [ ] Thêm người vào phòng đã có nháp tháng 12 → tiền tính theo người (ví dụ Internet) của nháp tháng 12 tăng theo.

## 6. Số người theo tháng
- [ ] Hoá đơn đã tạo giữ số người lúc tạo: sửa chỉ số điện nước sau đó không làm đổi các khoản tính theo người.
- [ ] Lưu ý: hoá đơn tạo TRƯỚC migration chưa lưu số người, vẫn đếm theo cư dân hiện tại (chờ bạn quyết có điền số cũ hay không).

## 7. Trả phòng và Sửa phòng
- [ ] Màn Sửa phòng (phòng có người): nút **Trả phòng** ngay dưới **Lưu thay đổi**; phòng trống thì không có nút.
- [ ] Bấm → popup "Bạn có muốn trả phòng?" liệt kê tên người ở; **Huỷ** thì không đổi gì.
- [ ] Xác nhận → về danh sách phòng, phòng về 0 người, hoá đơn tháng hiện tại vẫn còn, nháp tháng sau (chưa có tiền) bị xoá.
- [ ] Cư dân của phòng đó không đăng nhập được nữa.
- [ ] Quản lý Trung Kim không trả phòng được phòng của LVC (không thấy căn đó).
- [ ] Developer (tài khoản Developer) → Sửa phòng: thứ tự nút **Lưu, Huỷ, Xoá phòng**.

## 8. Nút thu tiền mặt
- [ ] Không có nút "tiền mặt" riêng nào. (Switch Đã đóng/Chưa đóng ở Phòng & Khách được giữ lại theo yêu cầu.)

## 9. Chuông thông báo thanh toán
- [ ] Chuông ở góc trên bên phải, cả máy tính và điện thoại (thu nhỏ cửa sổ ~390px để thử).
- [ ] Có thông báo chưa đọc → badge đỏ số lượng.
- [ ] Bấm chuông → danh sách: tiêu đề (Hoá đơn đã được thanh toán / Tiền vào hoá đơn đã thanh toán), căn, phòng, tháng, số tiền, "Nhận lúc …", nguồn (Ngân hàng SePay / Đánh dấu thủ công), nhãn **Mới**.
- [ ] Đóng rồi mở lại → các mục đó thành **Đã đọc**, badge mất.
- [ ] Ở tab Hoá đơn, đánh dấu một phòng "Đã đóng" → trong vòng 30 giây (hoặc khi quay lại tab) chuông có thông báo mới.
- [ ] Bỏ "Đã đóng" của phòng đó → thông báo đó biến mất; đánh dấu lại → có thông báo mới.
- [ ] Đăng nhập **Quản lý Trung Kim**: chỉ thấy thông báo của NHÀ TRỌ TRUNG KIM, không thấy LVC.
- [ ] Chủ trọ đọc hết không làm mất trạng thái "Mới" của quản lý (đã đọc tính riêng từng người).
- [ ] Phím Esc hoặc bấm ra ngoài đóng danh sách.

## Phần chỉ kiểm bằng test tự động (không thử tay được ở local)
- SePay gửi lại cùng một webhook → không có thông báo thứ hai; tiền vào hoá đơn đã trả → thông báo "tiền thừa" (`cloudflare/test/admin-alerts.test.ts`).
- Phòng ngoài căn trong `roomIds` bị từ chối 400 (`cloudflare/test/admin-billing.test.ts`).

## Chế độ Google Sheet
- [ ] (Nếu muốn) đổi sang Sheet: các màn như cũ, vẫn còn công tắc Đã đóng, không có chuông, không có 3 nút.
