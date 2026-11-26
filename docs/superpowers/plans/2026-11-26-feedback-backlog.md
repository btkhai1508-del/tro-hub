# Danh sách góp ý sau khi thử app (26/11/2026)

Nguồn: file "List lỗi app1.xlsx". Cột B = chung và máy tính, cột D = chỉ điện thoại.
Chia 8 đợt, làm lần lượt, deploy sau mỗi đợt khi người dùng nói "deploy".

## Quyết định đã chốt
- Không cộng phí cổng thanh toán 500đ cho cư dân (đã nằm trong gói chủ trọ mua). Bỏ mục 77.
- Cổng thanh toán là **trang công khai, không cần đăng nhập**, mỗi hoá đơn một link ngẫu nhiên không đoán được.
  Chỉ hiện thứ cần để trả tiền (căn, phòng, tháng, các khoản phí, tổng, QR, tài khoản, mã đơn); chỉ đọc; hoá đơn nháp chưa mở được;
  đã trả thì hiện "Đã thanh toán ngày …" và không hiện QR; chống dò link bằng giới hạn theo IP; chủ trọ có nút "Tạo lại link". Link không hết hạn khi hoá đơn chưa trả.
- Mất mạng: app mất mạng từ lúc mở thì đăng nhập/đăng ký báo "Mất kết nối internet, vui lòng chờ chút!", có mạng lại tự tải lại.
  Đã vào app thì hiện dữ liệu cũ kèm "đang ngoại tuyến"; thao tác ghi bị chặn và báo mất kết nối (không lưu tạm để gửi sau).
- QR sau khi đã thanh toán: QR ngân hàng không thu hồi được. Làm 3 việc: (1) hoá đơn đã trả thì app và PDF in lại không có QR, ghi "Đã thanh toán ngày …";
  (2) **ĐÃ CHỐT**: QR ở trang thanh toán trong app giữ nguyên là QR ngân hàng; QR trong PDF hoá đơn là QR link tới trang thanh toán công khai của phòng đó (không cần đăng nhập; đã trả thì trang không còn QR);
  (3) báo chủ trọ khi có tiền vào hoá đơn đã trả (code hiện chỉ tính thành "surplus", chưa chắc có thông báo).
- Mật khẩu (quên mật khẩu bằng CCCD, 123456, chủ trọ xem mật khẩu cư dân): **hoãn**, người dùng tính sâu rồi báo. Không làm.

## Đợt 1: chữ, tên gọi, icon, font
- Developer: "Admin tổng" → "Chủ trọ"; "Admin căn trọ" → "Ban Quản Lý Trọ".
- Đăng nhập: chữ Zalo "Đăng nhập Zalo chỉ khả dụng trong Zalo Mini App, vui lòng đăng nhập bằng số điện thoại bên dưới".
- Sai mật khẩu: tối đa 6 lần, báo "Bạn còn x lần".
- Sidebar: đầu sidebar "Trọ Hub" và dưới là tên nhà trọ; nút đăng xuất cư dân giống admin; mục sidebar cư dân hiện giống admin.
- Trang chủ cư dân: tiêu đề "Trọ-Hub, Căn trọ"; card chi phí bỏ chữ "Đã thanh toán" ở góc, phòng đã trả hiện "Đã thanh toán: [ngày]".
- Đổi tên: "Hoá đơn & Thanh toán" (dòng dưới "Quản lý chi phí"); "Tiện ích" (dòng dưới "Dành cho cư dân"); "Hợp đồng & cư trú"; "Hồ sơ cá nhân".
- Hoá đơn cư dân: "Người trọ" → "Người nộp tiền"; nút "Xem thêm hoá đơn" bỏ viền, chữ mỏng 10%.
- Thông báo cư dân: icon "đã cập nhật tất cả" bỏ nền, to hơn 40%.
- Font Apple cho đổi mật khẩu và input chi tiết phòng; chữ card "Lưu thay đổi" +5%, đậm, đen.
- Điện thoại: icon kỳ tháng → icon line; nút mũi tên bỏ nền; mọi trang thêm footer liên hệ ban quản lý (số điện thoại + Zalo).
- Liên hệ quản lý (đăng nhập và cư dân) tự điền số chủ trọ, hoặc manager nếu có.
- Quản lý tài khoản (đổi tên, sắp xếp: Quản lý tài khoản, Quản lý toà nhà, ô riêng Tạo tài khoản mới; ghi căn của người chờ duyệt; chờ duyệt lên đầu có đường kẻ); Ban Quản Lý Trọ có nút sửa thông tin.
- Bottom bar: thêm nút đăng xuất ngoài cùng (popup xác nhận), bỏ nút đăng xuất dưới kỳ tháng ở tablet.

## Đợt 2: hoá đơn cư dân, PDF, QR, trang thanh toán công khai
- Hoá đơn liệt kê các khoản phí theo dịch vụ phòng; chi tiết có công thức (điện nước = mới − cũ × đơn giá; xe máy = số chiếc); dòng Tổng cộng gộp ô Khoản và Chi tiết, nền xám nhạt; card theo kỳ không ghi số khoản.
- Sửa lỗi chữ "Đã thanh toán ngày" lặp hai lần; hoá đơn đã trả QR thì không hiện QR.
- QR thanh toán: bỏ format nội dung cũ (LVC/TK), giữ format mới, hết nháy 0,1 giây.
- PDF hoá đơn: có QR (bỏ nền) cạnh Tổng cộng, kèm tài khoản ngân hàng chủ trọ và Mã đơn (phải đúng); ghi rõ Tổng cộng; hạn thanh toán 1 tuần sau khi tạo hoá đơn; địa chỉ dưới tên căn nhà trọ góc trái.
- Trang thanh toán công khai (xem quyết định trên) + QR cạnh Tổng cộng, bấm để copy link.
- (HOÃN, làm cuối cùng sau khi mọi đợt xong, không cấp bách) Gửi hoá đơn qua email cho cư dân có email: cần chọn dịch vụ gửi mail và người dùng tự nhập khoá API.
- Lịch sử thanh toán ghi thời gian SePay nhận tiền.

## Đợt 3: điện nước dạng bảng
- Bảng: hàng ngang "Cũ, Mới, Cũ, Mới", cột là số phòng, kẻ line ngang, tiêu đề nổi bật.
- Chỉ số cũ tháng x = chỉ số mới tháng trước; sửa tháng trước thì các tháng sau tự cập nhật.
- Bỏ nút "Mở thu tiền tháng", bỏ dòng "tổng tiền cần thu", chỉ ghi chỉ số và lượng dùng.
- Điện thoại: giữ kiểu chỉ nhập điện mới, nước mới từng phòng.

## Đợt 4: Phòng & Khách gộp hoá đơn
- Hiện sẵn chi tiết các khoản phí; bấm phòng là sửa phòng.
- Cột chọn phòng (chọn từng phòng / chọn tất cả); ba nút Tình trạng thanh toán, Tạo hoá đơn, Sửa hoá đơn; "Tạo hoá đơn" tạo cho phòng đã chọn, chưa chọn thì yêu cầu chọn.
- Nút "Tạo tất cả hoá đơn" dưới tìm kiếm/lọc, bấm là gửi thông báo thanh toán cho toàn bộ cư dân.
- Đổi tháng tải dữ liệu tháng cũ; thêm người ở ghép tháng sau thì tự tạo cho tháng đó; cập nhật số người ở theo tháng (hợp đồng).
- Nút Trả phòng dưới Lưu thay đổi (popup xác nhận); sửa phòng: Lưu, Huỷ, Xoá phòng.
- Bỏ nút thu tiền mặt.

## Đợt 5: Tổng quan, thông báo
- Điện/nước tiêu thụ hiện kWh và m³; doanh thu tổng, chọn tổng hoặc từng căn (fade chậm); card xe máy ghi "Xe máy: 68".
- Dòng "Đang chuẩn bị hoá đơn tháng …" đổi thành popup.
- Điện thoại: card xe máy căn giữa 3 khoảng; bỏ card "Thu tiền".
- Thông báo: ô Phòng nhận và Loại thông báo dạng chọn thả xuống; loại gồm Thông báo chung, Nhắc nhở, Quan trọng; bỏ "Mẫu gửi thông báo cư dân".

## Đợt 6: Developer
- Email chủ trọ bắt buộc; bỏ nút xoá cạnh căn trọ (giữ trong ô sửa chủ trọ).
- Tạo/sửa chủ trọ và căn trọ: trang riêng, tối giản, không popup (điện thoại cũng vậy).
- Tiện ích theo căn: các tiện ích hiện có nằm hết trong gói; thêm dòng "muốn thêm tiện ích, liên hệ email để được báo giá".
- Developer đăng nhập cần Google Authentication.

## Đợt 7: đăng nhập, đăng ký, mất mạng, loading
- Đăng ký mới: bước 1 nhập số điện thoại chủ trọ; form: Họ tên + Số điện thoại + Giới tính cùng một dòng, dòng sau Căn trọ + Số phòng.
- Quản lý tài khoản → Đăng ký mới: thêm chế độ link (chọn căn + phòng, gửi link cho cư dân tự điền), không ghi chú trên giao diện.
- Làm mới / đổi tháng: lớp loading toàn trang (fade nhanh-vừa, giảm độ trong suốt, spinner giữa), bỏ ô "đang cập nhật" cạnh tiêu đề.
- Mất mạng (xem quyết định).

## Đợt 8: xuất file, kỳ kê khai
- Tiện ích xuất Excel/PDF báo cáo cho chủ trọ (format như Google Sheet trước, bỏ tab quản lý tài khoản).
- Đổi tên "Lịch sử thanh toán / Kỳ kê khai"; PDF kê khai ghi ngày thanh toán, người thuê, số tiền (không số phòng); bỏ nút "Lưu số kê khai" (tự lưu); ngày tháng "/ /" tự ghi, số tiền tự điền kèm "đ"; bỏ chữ mẫu A, B, 1 khi in; Embed PDF không bo tròn, giữ khổ A4.

## Đã có sẵn, chỉ cần kiểm tra
- Ngày 26 tự chuẩn bị tháng sau (đã làm); nút "Mở thu tiền tháng" ở Điện nước đã bỏ.
- Chế độ sáng/tối ổn; Lưu trữ ổn.
