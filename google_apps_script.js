/**
 * GOOGLE APPS SCRIPT CHO NHÀ TRỌ PHONG LAN (TRO-HUB)
 * Tự động đồng bộ 2 chiều:
 * 1. Ô Q2: Đóng/Mở cổng thanh toán (START / STOP)
 * 2. Tab "Notifications": Lưu thông báo từ Admin (Cột A: Date, B: Phòng, C: Loại, D: Nội dung)
 * 3. Cập nhật thanh toán (Cột P: ĐÃ ĐÓNG / CHƯA ĐÓNG)
 * 4. Cập nhật chỉ số điện/nước
 * 5. Đồng bộ một chiều tab THÔNG TIN CÁ NHÂN sang các tab tháng (cột Q:AB)
 */

var DEFAULT_SPREADSHEET_ID = "1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A";

/**
 * HÀM KIỂM TRA & CẤP QUYỀN TRUY CẬP (Bấm nút 'Chạy' / 'Run' trên thanh công cụ Apps Script để cấp quyền)
 */
function testPermission() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  }
  Logger.log("✅ Kết nối thành công tới Sheet: " + ss.getName() + " (ID: " + ss.getId() + ")");
  var sheet = ss.getActiveSheet();
  Logger.log("Tab hiện tại: " + sheet.getName());
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return createJsonResponse({ success: false, error: "Server busy, please retry" });
  }

  try {
    var params = {};
    if (e && e.parameter) {
      params = e.parameter;
    }
    if (e && e.postData && e.postData.contents) {
      try {
        var postJson = JSON.parse(e.postData.contents);
        for (var k in postJson) {
          params[k] = postJson[k];
        }
      } catch (err) {}
    }

    var action = params.action || "";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      try {
        ss = SpreadsheetApp.openById(params.sheetId || DEFAULT_SPREADSHEET_ID);
      } catch (err) {}
    }
    if (!ss) {
      return createJsonResponse({ success: false, error: "Không thể mở Google Spreadsheet. Vui lòng kiểm tra ID bảng tính." });
    }

    // ----------------------------------------------------
    // ACTION 0: APP LƯU HỒ SƠ CƯ DÂN VÀO TAB THÔNG TIN CÁ NHÂN
    // ----------------------------------------------------
    if (action === "update_profile") {
      return createJsonResponse(capNhatHoSoCuDan_(ss, params));
    }

    // ----------------------------------------------------
    // ACTION 0B: TẠO, DUYỆT VÀ XOÁ TÀI KHOẢN CƯ DÂN
    // ----------------------------------------------------
    if (action === "register_account") {
      return createJsonResponse(taoTaiKhoan_(ss, params));
    }
    if (action === "update_account_status") {
      return createJsonResponse(capNhatTrangThaiTaiKhoan_(ss, params));
    }
    if (action === "delete_resident" || action === "delete_account") {
      return createJsonResponse(xoaCuDan_(ss, params, action));
    }

    // ----------------------------------------------------
    // ACTION 1: CẬP NHẬT Ô Q2 (CỔNG THANH TOÁN START / STOP)
    // ----------------------------------------------------
    if (action === "update_q2" || action === "set_payment_gate") {
      var month = String(params.month || "").trim();
      var status = String(params.status || params.value || "STOP").toUpperCase().trim();
      if (status !== "START" && status !== "STOP") {
        status = "STOP";
      }

      var sheet = null;
      // Tìm sheet theo tên tháng (10/2026, 102026, Tháng 10/2026, T10/2026...)
      if (month) {
        var rawDigits = month.replace(/\D/g, "");
        sheet = ss.getSheetByName(month) || 
                ss.getSheetByName(rawDigits) || 
                ss.getSheetByName("Tháng " + month) || 
                ss.getSheetByName("T" + month) || 
                ss.getSheetByName("Tháng " + rawDigits);
      }
      if (!sheet) {
        // Mặc định lấy sheet đầu tiên có chứa chữ số tháng
        var sheets = ss.getSheets();
        for (var i = 0; i < sheets.length; i++) {
          var name = sheets[i].getName();
          if (/^\d+$/.test(name) || name.indexOf("/") !== -1) {
            sheet = sheets[i];
            break;
          }
        }
      }

      if (sheet) {
        // Ghi trực tiếp vào ô Q2 (Cột Q, dòng 2)
        sheet.getRange("Q2").setValue(status);
        SpreadsheetApp.flush(); // Áp dụng ngay lập tức trên Google Sheet
        return createJsonResponse({
          success: true,
          message: "Đã cập nhật ô Q2 thành " + status + " trên sheet " + sheet.getName(),
          sheet: sheet.getName(),
          cell: "Q2",
          value: status
        });
      } else {
        return createJsonResponse({ success: false, error: "Không tìm thấy sheet cho tháng: " + month });
      }
    }

    // ----------------------------------------------------
    // ACTION 2: THÊM THÔNG BÁO VÀO TAB "Notifications"
    // Schema từ Row 2 trở đi:
    // Cột A: Date
    // Cột B: Phòng
    // Cột C: Loại thông báo
    // Cột D: Nội dung
    // Cột E: Giờ hẹn gửi
    // ----------------------------------------------------
    if (action === "add_notification") {
      var notifSheet = ss.getSheetByName("Notifications");
      if (!notifSheet) {
        notifSheet = ss.insertSheet("Notifications");
        // Khởi tạo hàng tiêu đề Row 1
        notifSheet.appendRow(["Date", "Phòng", "Loại", "Nội dung"]);
      }

      var dateVal = params.date || Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm");
      var roomVal = params.room || "Tất cả";
      var typeVal = params.type || "Thông báo";
      var contentVal = params.content || "";

      // Cột E: giờ hẹn gửi (để trống là gửi ngay)
      notifSheet.appendRow([dateVal, roomVal, typeVal, contentVal, params.scheduledAt || ""]);
      SpreadsheetApp.flush();

      return createJsonResponse({
        success: true,
        message: "Đã ghi nhận thông báo vào tab Notifications",
        date: dateVal,
        room: roomVal,
        type: typeVal,
        content: contentVal
      });
    }

    // ----------------------------------------------------
    // ACTION 3: CẬP NHẬT TRẠNG THÁI THANH TOÁN (CỘT P)
    // Nút xác nhận thu tiền: Tô highlight cột P tương ứng row/phòng sang màu xanh lá
    // ----------------------------------------------------
    if (action === "update_payment") {
      var month = String(params.month || "").trim();
      var rawDigits = month.replace(/\D/g, "");
      var targetSheet = ss.getSheetByName(month) || 
                        ss.getSheetByName(rawDigits) || 
                        ss.getSheetByName("Tháng " + month) || 
                        ss.getSheetByName("T" + month) || 
                        ss.getSheetByName("Tháng " + rawDigits);
      
      if (!targetSheet) {
        var allSheets = ss.getSheets();
        for (var s = 0; s < allSheets.length; s++) {
          var sName = allSheets[s].getName().toLowerCase();
          if (sName.indexOf(month.toLowerCase()) !== -1 || (rawDigits && sName.indexOf(rawDigits) !== -1)) {
            targetSheet = allSheets[s];
            break;
          }
        }
      }

      if (!targetSheet) {
        targetSheet = ss.getActiveSheet();
      }

      var targetRoom = String(params.room || "").trim();
      var isPaid = String(params.status || "").toLowerCase() === "paid";
      var targetRow = parseInt(params.row, 10);

      // 1. Nếu có chỉ định số dòng chính xác (phòng trọ luôn từ dòng 7 đến 50)
      if (targetRow && targetRow >= 7 && targetRow <= 50) {
        var cellP = targetSheet.getRange(targetRow, 16);
        cellP.setBackground(isPaid ? "#b6d7a8" : "#F8D7DA");
        SpreadsheetApp.flush();
        return createJsonResponse({
          success: true,
          message: "Đã cập nhật highlight cột P dòng " + targetRow + " sang " + (isPaid ? "màu xanh lá (#b6d7a8)" : "màu đỏ pastel (#F8D7DA)"),
          row: targetRow,
          color: isPaid ? "#b6d7a8" : "#F8D7DA",
          status: isPaid ? "paid" : "unpaid"
        });
      }

      // Hàm chuẩn hóa mã phòng để khớp chính xác cột A
      function normRoom(val) {
        if (!val) return "";
        var str = String(val).trim().toUpperCase()
          .replace(/^(P\.|P\s+|PHÒNG\s+)/i, "")
          .replace(/\.0+$/, "");
        if (str.indexOf("LVC") !== -1) {
          var n = str.replace(/\D/g, "");
          return n ? "LVC-" + n : str;
        }
        if (/^G\d+$/i.test(str)) {
          var n = str.replace(/\D/g, "");
          return "G" + (n.length === 1 ? "0" + n : n);
        }
        if (/^\d+$/.test(str)) {
          return str.replace(/^0+/, "") || str;
        }
        return str;
      }

      var cleanTarget = normRoom(targetRoom);
      var data = targetSheet.getDataRange().getValues();

      // BẮT BUỘC: Chỉ duyệt từ dòng 7 (index r = 6) đến dòng 50 (index r = 49)
      // TUYỆT ĐỐI BỎ QUA dòng 1-6 (là các dòng tiêu đề bảng và ghi chú, không phải phòng)
      for (var r = 6; r < Math.min(data.length, 50); r++) {
        var colA = String(data[r][0] || "").trim(); // Cột A: Mã phòng
        if (normRoom(colA) === cleanTarget) {
          var rowNum = r + 1; // 1-indexed dòng trên Google Sheet
          var cellP = targetSheet.getRange(rowNum, 16); // Cột P (cột 16)
          cellP.setBackground(isPaid ? "#b6d7a8" : "#F8D7DA");
          SpreadsheetApp.flush();
          return createJsonResponse({
            success: true,
            message: "Đã cập nhật highlight cột P phòng " + targetRoom + " (dòng " + rowNum + ") sang " + (isPaid ? "màu xanh lá (#b6d7a8)" : "màu đỏ pastel (#F8D7DA)"),
            row: rowNum,
            color: isPaid ? "#b6d7a8" : "#F8D7DA",
            status: isPaid ? "paid" : "unpaid"
          });
        }
      }

      return createJsonResponse({ success: false, error: "Không tìm thấy phòng " + targetRoom + " trong sheet " + targetSheet.getName() });
    }

    // ----------------------------------------------------
    // ACTION 4: CẬP NHẬT ĐƠN GIÁ PHÍ DỊCH VỤ (DÒNG 5)
    // Cột H5: Đơn giá điện, I5: Đơn giá nước, K5: Tiền rác, L5: Tiền internet, M5: Tiền xe
    // ----------------------------------------------------
    if (action === "update_config" || action === "set_config") {
      var month = String(params.month || "").trim();
      var rawDigits = month.replace(/\D/g, "");
      var targetSheet = ss.getSheetByName(month) || 
                        ss.getSheetByName(rawDigits) || 
                        ss.getSheetByName("Tháng " + month) || 
                        ss.getSheetByName("T" + month) || 
                        ss.getSheetByName("Tháng " + rawDigits);

      if (!targetSheet) targetSheet = ss.getActiveSheet();

      // Cột H5 (cột 8): Đơn giá điện
      if (params.dien !== undefined && params.dien !== "") targetSheet.getRange("H5").setValue(Number(params.dien));
      // Cột I5 (cột 9): Đơn giá nước
      if (params.nuoc !== undefined && params.nuoc !== "") targetSheet.getRange("I5").setValue(Number(params.nuoc));
      // Cột K5 (cột 11): Tiền rác
      if (params.rac !== undefined && params.rac !== "") targetSheet.getRange("K5").setValue(Number(params.rac));
      // Cột L5 (cột 12): Tiền internet
      if (params.net !== undefined && params.net !== "") targetSheet.getRange("L5").setValue(Number(params.net));
      // Cột M5 (cột 13): Tiền xe
      if (params.xe !== undefined && params.xe !== "") targetSheet.getRange("M5").setValue(Number(params.xe));

      SpreadsheetApp.flush();
      return createJsonResponse({
        success: true,
        message: "Đã cập nhật đơn giá tháng " + targetSheet.getName() + " vào các ô H5, I5, K5, L5, M5 thành công",
        dien: params.dien,
        nuoc: params.nuoc,
        rac: params.rac,
        net: params.net,
        xe: params.xe
      });
    }

    // ----------------------------------------------------
    // ACTION 5: LAUNDRY - GHI NHẬN PHIÊN GIẶT (SESSIONS)
    // ----------------------------------------------------
    if (action === "laundry_add_session") {
      var sessSheet = ss.getSheetByName("Laundry_Sessions");
      if (!sessSheet) {
        sessSheet = ss.insertSheet("Laundry_Sessions");
        sessSheet.appendRow(["Session ID", "Mã máy", "Phòng", "Khách hàng", "SĐT", "Bắt đầu", "Kết thúc dự kiến", "Số tiền", "Mã GD", "Trạng thái"]);
        sessSheet.getRange(1, 1, 1, 10).setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
        sessSheet.setFrozenRows(1);
      }
      sessSheet.appendRow([
        params.sessionId || "",
        params.machineId || "",
        params.room || "",
        params.name || "",
        params.phone || "",
        params.startTime || "",
        params.expectedEndTime || "",
        Number(params.amount) || 0,
        params.transactionId || "",
        params.status || "IN_PROGRESS"
      ]);
      SpreadsheetApp.flush();
      return createJsonResponse({ success: true, message: "Đã ghi phiên giặt sấy vào tab Laundry_Sessions" });
    }

    // ----------------------------------------------------
    // ACTION 6: LAUNDRY - ĐỒNG BỘ TRẠNG THÁI MÁY (MACHINES)
    // ----------------------------------------------------
    if (action === "laundry_sync_machine") {
      var machSheet = ss.getSheetByName("Machines");
      if (!machSheet) {
        machSheet = ss.insertSheet("Machines");
        machSheet.appendRow(["machine_id", "name", "type", "status", "price", "cycle_minutes", "expected_end_time", "plug_state"]);
        machSheet.getRange(1, 1, 1, 8).setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
        machSheet.setFrozenRows(1);
      }
      var machData = machSheet.getDataRange().getValues();
      var machineId = String(params.machineId || "").trim().toUpperCase();
      var foundRow = -1;
      for (var mi = 1; mi < machData.length; mi++) {
        if (String(machData[mi][0]).toUpperCase().trim() === machineId) {
          foundRow = mi + 1;
          break;
        }
      }
      var rowValues = [
        machineId,
        params.name || "",
        params.type || "",
        params.status || "AVAILABLE",
        Number(params.price) || 5000,
        Number(params.cycleMinutes) || 45,
        params.expectedEndTime || "",
        params.plugState || "OFF"
      ];
      if (foundRow > 0) {
        machSheet.getRange(foundRow, 1, 1, 8).setValues([rowValues]);
      } else {
        machSheet.appendRow(rowValues);
      }
      SpreadsheetApp.flush();
      return createJsonResponse({ success: true, message: "Đã đồng bộ trạng thái máy " + machineId });
    }

    // ----------------------------------------------------
    // ACTION 7: LAUNDRY - GHI ĐẶT CHỖ (BOOKINGS)
    // ----------------------------------------------------
    if (action === "laundry_add_booking") {
      var bookSheet = ss.getSheetByName("Laundry_Bookings");
      if (!bookSheet) {
        bookSheet = ss.insertSheet("Laundry_Bookings");
        bookSheet.appendRow(["Booking ID", "Mã máy", "Phòng", "Khách hàng", "SĐT", "Ngày hẹn", "Giờ hẹn", "Tiền cọc", "Trạng thái cọc", "Mã GD", "Trạng thái", "Ngày tạo"]);
        bookSheet.getRange(1, 1, 1, 12).setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
        bookSheet.setFrozenRows(1);
      }
      bookSheet.appendRow([
        params.bookingId || "",
        params.machineId || "",
        params.room || "",
        params.name || "",
        params.phone || "",
        params.bookingDate || "",
        params.bookingTime || "",
        Number(params.depositAmount) || 0,
        params.depositStatus || "PENDING",
        params.transactionId || "",
        params.status || "ACTIVE",
        params.createdAt || new Date().toLocaleString("vi-VN")
      ]);
      SpreadsheetApp.flush();
      return createJsonResponse({ success: true, message: "Đã ghi lịch đặt chỗ vào tab Laundry_Bookings" });
    }

    // ----------------------------------------------------
    // ACTION 8: LAUNDRY - XÁC NHẬN CỌC ĐẶT CHỖ
    // ----------------------------------------------------
    if (action === "laundry_confirm_deposit") {
      var bookSheet = ss.getSheetByName("Laundry_Bookings");
      if (bookSheet) {
        var bData = bookSheet.getDataRange().getValues();
        var bId = String(params.bookingId || "").trim();
        var mId = String(params.machineId || "").trim().toUpperCase();
        for (var bi = 1; bi < bData.length; bi++) {
          if ((bId && String(bData[bi][0]).trim() === bId) || (!bId && String(bData[bi][1]).trim().toUpperCase() === mId && String(bData[bi][8]).toUpperCase() === "PENDING")) {
            bookSheet.getRange(bi + 1, 9).setValue("PAID");
            if (params.transactionId) bookSheet.getRange(bi + 1, 10).setValue(params.transactionId);
            break;
          }
        }
        SpreadsheetApp.flush();
      }
      return createJsonResponse({ success: true, message: "Đã cập nhật trạng thái cọc đặt chỗ" });
    }

    return createJsonResponse({ success: true, message: "EcoStay Apps Script Web App is active" });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------
// MENU TIỆN ÍCH TRÊN GOOGLE SHEETS
// ----------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏢 Nhà Trọ Phong Lan')
    .addItem('👀 Xem trước đồng bộ cư dân', 'xemTruocDongBo')
    .addItem('🔄 Đồng bộ tab cá nhân sang tháng hiện tại', 'dongBoThangHienTai')
    .addItem('🗂 Đồng bộ tất cả các tháng', 'dongBoTatCaThang')
    .addSeparator()
    .addItem('✅ Đánh dấu ĐÃ THANH TOÁN (Màu xanh lá Cột P)', 'markRowPaid')
    .addItem('⏳ Đánh dấu CHƯA THANH TOÁN (Màu đỏ Cột P)', 'markRowUnpaid')
    .addToUi();
}

function showAlertSafely(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}

function getSafeSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    try {
      ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
    } catch (e) {
      Logger.log("Không thể mở Spreadsheet: " + e);
    }
  }
  return ss;
}

// ----------------------------------------------------
// ĐỒNG BỘ TAB "THÔNG TIN CÁ NHÂN" -> CÁC TAB THÁNG
//   Cá nhân A (Họ tên)    -> Tháng Q / U / Y
//   Cá nhân C (SĐT)       -> Tháng S / W / AA
//   Cá nhân D (CCCD)      -> Tháng R / V / Z
//   Cá nhân H (Biển số)   -> Tháng T / X / AB
//   Cá nhân J (Phòng)     -> Tháng A (tìm đúng dòng phòng)
// Chỉ ghi vào Q:AB. Ô bên tab cá nhân để trống thì giữ nguyên giá trị đang có ở tab tháng.
// Mặc định chỉ ghi tháng hiện tại trở đi để không đổi dữ liệu các tháng đã qua.
// Tháng hiện tại chưa có tab thì không ghi gì.
// ----------------------------------------------------
var TAB_CA_NHAN = 'THÔNG TIN CÁ NHÂN';
var COT_Q = 17;

// false: người có ở tab tháng mà không có ở tab cá nhân được giữ lại và ghi vào báo cáo.
// Chỉ đổi thành true sau khi đã bổ sung đủ người vào tab cá nhân (người đã rời phòng sẽ bị xoá khỏi tab tháng).
var XOA_NGUOI_KHONG_CO_O_TAB_CA_NHAN = false;

function chuanHoaPhong_(value) {
  var room = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
  room = room.replace(/^(PHÒNG|P\.|P)\s*/, '').replace(/\.0+$/, '').replace(/[\s-]/g, '');
  return /^(G\d+|LVC\d+|\d{3})$/.test(room) ? room : '';
}

function chuanHoaTen_(value) {
  return String(value === null || value === undefined ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Ô tên chỉ chứa số (1, 2.0...) là số đếm người, không phải tên. */
function laTenThat_(value) {
  var text = String(value === null || value === undefined ? '' : value).trim();
  return Boolean(text) && !/^[\d.,\s]+$/.test(text);
}

function chuanHoaCccd_(value) {
  var text = String(value === null || value === undefined ? '' : value).trim();
  var digits = text.replace(/\D/g, '');
  return digits.length === 11 ? '0' + digits : (digits.length === 12 ? digits : text);
}

function chuanHoaSdt_(value) {
  var text = String(value === null || value === undefined ? '' : value).trim();
  var digits = text.replace(/\D/g, '');
  return digits.length === 9 ? '0' + digits : (digits.length === 10 ? digits : text);
}

/** "10/2026" hoặc "102026" -> số để so sánh thứ tự tháng; tab khác trả về 0. */
function kyCuaTab_(name) {
  var match = String(name).trim().match(/^(\d{1,2})\/?(\d{4})$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return 0;
  return Number(match[2]) * 12 + Number(match[1]);
}

function layTabThang_(ss, tatCa) {
  var tabs = ss.getSheets().filter(function (sheet) { return kyCuaTab_(sheet.getName()) > 0; });
  if (tatCa) return tabs;
  var now = new Date();
  var hienTai = now.getFullYear() * 12 + now.getMonth() + 1;
  return tabs.filter(function (sheet) { return kyCuaTab_(sheet.getName()) >= hienTai; });
}

/** Tài khoản đang chờ duyệt hoặc bị từ chối chưa phải người ở, nên chưa vào tab tháng. */
function daDuyet_(tinhTrang) {
  var text = String(tinhTrang === null || tinhTrang === undefined ? '' : tinhTrang).trim().toUpperCase();
  return text !== 'CHỜ DUYỆT' && text !== 'TỪ CHỐI';
}

/** Gom cư dân theo phòng, giữ thứ tự dòng; dòng Admin/TEST không phải phòng nên tự bị bỏ qua. */
function docCuDanTheoPhong_(ss) {
  var sheet = ss.getSheetByName(TAB_CA_NHAN);
  if (!sheet) throw new Error('Không tìm thấy tab ' + TAB_CA_NHAN);
  var rows = sheet.getDataRange().getValues();
  var byRoom = {};
  for (var i = 1; i < rows.length; i++) {
    var room = chuanHoaPhong_(rows[i][9]);
    if (!room || !laTenThat_(rows[i][0]) || !daDuyet_(rows[i][15])) continue;
    var key = chuanHoaTen_(rows[i][0]);
    byRoom[room] = byRoom[room] || [];
    if (byRoom[room].some(function (p) { return p.key === key; })) continue;
    byRoom[room].push({
      key: key,
      name: String(rows[i][0]).trim(),
      cccd: chuanHoaCccd_(rows[i][3]),
      phone: chuanHoaSdt_(rows[i][2]),
      plate: String(rows[i][7] === null || rows[i][7] === undefined ? '' : rows[i][7]).trim()
    });
  }
  return byRoom;
}

/** Thứ tự trong mỗi người ở Q:AB là Họ tên, CCCD, SĐT, Biển số. */
function ghepPhong_(oCu, nguoi, phong, tenTab, baoCao) {
  var o = oCu.map(function (v) { return v === null || v === undefined ? '' : v; });
  var conLai = nguoi.slice();
  var slots = [0, 1, 2].map(function (i) { return { start: i * 4, person: null, name: o[i * 4] }; });

  slots.forEach(function (slot) {
    if (!laTenThat_(slot.name)) return;
    var key = chuanHoaTen_(slot.name);
    var idx = -1;
    conLai.forEach(function (p, j) { if (idx === -1 && p.key === key) idx = j; });
    if (idx !== -1) {
      slot.person = conLai.splice(idx, 1)[0];
    } else if (XOA_NGUOI_KHONG_CO_O_TAB_CA_NHAN) {
      [0, 1, 2, 3].forEach(function (k) { o[slot.start + k] = ''; });
      baoCao.push(tenTab + ' - phòng ' + phong + ': đã xoá "' + slot.name + '" vì không có ở tab cá nhân.');
    } else {
      baoCao.push(tenTab + ' - phòng ' + phong + ': "' + slot.name + '" chưa có ở tab cá nhân, giữ nguyên.');
    }
  });

  // Người mới vào ô trống, kể cả ô chỉ chứa số đếm.
  slots.forEach(function (slot) {
    if (slot.person || laTenThat_(o[slot.start]) || conLai.length === 0) return;
    slot.person = conLai.shift();
    [1, 2, 3].forEach(function (k) { o[slot.start + k] = ''; });
  });
  conLai.forEach(function (p) {
    baoCao.push(tenTab + ' - phòng ' + phong + ': "' + p.name + '" chưa có chỗ vì phòng đã đủ 3 người.');
  });

  slots.forEach(function (slot) {
    if (!slot.person) return;
    o[slot.start] = slot.person.name;
    if (slot.person.cccd) o[slot.start + 1] = slot.person.cccd;
    if (slot.person.phone) o[slot.start + 2] = slot.person.phone;
    if (slot.person.plate) o[slot.start + 3] = slot.person.plate;
  });
  return o;
}

function dongBoMotTab_(sheet, byRoom, ghiThat, ketQua) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  var phong = sheet.getRange(1, 1, lastRow, 1).getValues();
  var seen = {};
  for (var i = 0; i < lastRow; i++) {
    var room = chuanHoaPhong_(phong[i][0]);
    if (!room) continue;
    seen[room] = true;
    if (!byRoom[room] && !XOA_NGUOI_KHONG_CO_O_TAB_CA_NHAN) continue;
    var range = sheet.getRange(i + 1, COT_Q, 1, 12);
    var cu = range.getValues()[0];
    var moi = ghepPhong_(cu, byRoom[room] || [], room, sheet.getName(), ketQua.baoCao);
    var doi = moi.some(function (v, k) { return String(v) !== String(cu[k] === null || cu[k] === undefined ? '' : cu[k]); });
    if (!doi) continue;
    ketQua.soDong += 1;
    if (ghiThat) {
      // Dạng văn bản để không mất số 0 đầu của CCCD và SĐT.
      range.setNumberFormat('@');
      range.setValues([moi.map(String)]);
    }
  }
  Object.keys(byRoom).forEach(function (room) {
    if (!seen[room]) ketQua.baoCao.push(sheet.getName() + ': không có dòng cho phòng ' + room + '.');
  });
}

function dongBoCuDan_(ss, tatCa, ghiThat) {
  var ketQua = { soDong: 0, baoCao: [], tabs: [] };
  var byRoom = docCuDanTheoPhong_(ss);
  layTabThang_(ss, tatCa).forEach(function (sheet) {
    ketQua.tabs.push(sheet.getName());
    dongBoMotTab_(sheet, byRoom, ghiThat, ketQua);
  });
  return ketQua;
}

function hienKetQuaDongBo_(tieuDe, ketQua) {
  var dong = [tieuDe, 'Tab: ' + (ketQua.tabs.join(', ') || 'chưa có tab tháng này, chưa có dữ liệu để đồng bộ'), 'Số phòng thay đổi: ' + ketQua.soDong];
  if (ketQua.baoCao.length) dong.push('', 'Cần xem lại:', ketQua.baoCao.slice(0, 30).join('\n'));
  Logger.log(dong.join('\n'));
  showAlertSafely(dong.join('\n'));
}

function xemTruocDongBo() {
  hienKetQuaDongBo_('XEM TRƯỚC (chưa ghi gì vào Sheet)', dongBoCuDan_(getSafeSpreadsheet(), false, false));
}

function dongBoThangHienTai() {
  hienKetQuaDongBo_('ĐÃ ĐỒNG BỘ', dongBoCuDan_(getSafeSpreadsheet(), false, true));
}

/** Ghi đè cả các tháng đã qua, nên phải xác nhận trước khi chạy. */
function dongBoTatCaThang() {
  var ui = SpreadsheetApp.getUi();
  var traLoi = ui.alert('Đồng bộ tất cả các tháng?', 'Thông tin cư dân của các tháng đã qua cũng sẽ bị thay đổi.', ui.ButtonSet.YES_NO);
  if (traLoi !== ui.Button.YES) return;
  hienKetQuaDongBo_('ĐÃ ĐỒNG BỘ TẤT CẢ', dongBoCuDan_(getSafeSpreadsheet(), true, true));
}

/** Sửa tên, SĐT, CCCD, biển số hoặc phòng ở tab cá nhân thì tab tháng tự cập nhật. */
function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== TAB_CA_NHAN || e.range.getLastRow() < 2) return;
  var cotDau = e.range.getColumn();
  var cotCuoi = e.range.getLastColumn();
  var coCotLienQuan = [1, 3, 4, 8, 10].some(function (cot) { return cot >= cotDau && cot <= cotCuoi; });
  if (!coCotLienQuan) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;
  try {
    var ss = e.source;
    var ketQua = dongBoCuDan_(ss, false, true);
    if (ketQua.soDong) ss.toast('Đã cập nhật ' + ketQua.soDong + ' phòng ở tab ' + ketQua.tabs.join(', '), 'Đồng bộ cư dân', 5);
  } finally {
    lock.releaseLock();
  }
}

/** Gắn vào trigger "Khi có thay đổi": tạo, nhân bản hoặc đổi tên tab tháng thì tự đồng bộ. */
function khiBangThayDoi(e) {
  if (e && e.changeType === 'EDIT') return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;
  try {
    dongBoCuDan_(getSafeSpreadsheet(), false, true);
  } finally {
    lock.releaseLock();
  }
}

/** Tên và SĐT cùng khớp trước vì có SĐT dùng chung nhiều người; sau đó SĐT, cuối cùng là tên trong đúng phòng. */
function timDongCuDan_(rows, phone, name, room) {
  var so = function (v) { return String(v === null || v === undefined ? '' : v).replace(/\D/g, '').slice(-9); };
  var phoneCu = so(phone);
  var phong = chuanHoaPhong_(room);
  var ten = chuanHoaTen_(name);
  var i;
  for (i = 1; i < rows.length; i++) {
    if (phoneCu.length === 9 && so(rows[i][2]) === phoneCu && chuanHoaTen_(rows[i][0]) === ten) return i;
  }
  for (i = 1; i < rows.length; i++) {
    if (phoneCu.length === 9 && so(rows[i][2]) === phoneCu) return i;
  }
  for (i = 1; i < rows.length; i++) {
    if (ten && phong && chuanHoaTen_(rows[i][0]) === ten && chuanHoaPhong_(rows[i][9]) === phong) return i;
  }
  return -1;
}

/** Tạo dòng mới ở tab cá nhân; cột O (Ngày tham gia) là ngày tạo tài khoản. */
function taoTaiKhoan_(ss, params) {
  var ketQuaLoi = function (error) { return { success: false, action: 'register_account', error: error }; };
  var sheet = ss.getSheetByName(TAB_CA_NHAN);
  if (!sheet) return ketQuaLoi('Không tìm thấy tab ' + TAB_CA_NHAN);
  var phone = chuanHoaSdt_(params.phone);
  var soMoi = String(phone).replace(/\D/g, '').slice(-9);
  var rows = sheet.getDataRange().getValues();
  var trung = rows.slice(1).some(function (row) { return String(row[2] === null || row[2] === undefined ? '' : row[2]).replace(/\D/g, '').slice(-9) === soMoi; });
  if (trung) return ketQuaLoi('Số điện thoại này đã được đăng ký trên hệ thống');
  var ngay = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  var tinhTrang = params.approved === true || params.approved === 'true' ? 'ĐÃ DUYỆT' : 'CHỜ DUYỆT';
  var dong = sheet.getLastRow() + 1;
  var range = sheet.getRange(dong, 1, 1, 16);
  range.setNumberFormat('@');
  range.setValues([[params.name || '', params.gender || '', phone, '', params.email || '', '', '', '', 'Xe máy', params.room || '', '', '', '', params.password || '', ngay, tinhTrang]]);
  dongBoCuDan_(ss, false, true);
  return { success: true, action: 'register_account', row: dong, joinedAt: ngay, status: tinhTrang };
}

function capNhatTrangThaiTaiKhoan_(ss, params) {
  var sheet = ss.getSheetByName(TAB_CA_NHAN);
  if (!sheet) return { success: false, action: 'update_account_status', error: 'Không tìm thấy tab ' + TAB_CA_NHAN };
  var dong = timDongCuDan_(sheet.getDataRange().getValues(), params.phone, params.name, params.room);
  if (dong === -1) return { success: false, action: 'update_account_status', error: 'Không tìm thấy tài khoản' };
  sheet.getRange(dong + 1, 16).setValue(params.status === 'rejected' ? 'TỪ CHỐI' : params.status === 'pending' ? 'CHỜ DUYỆT' : 'ĐÃ DUYỆT');
  dongBoCuDan_(ss, false, true);
  return { success: true, action: 'update_account_status' };
}

/** Bỏ người này khỏi ô người ở Q:AB của tháng hiện tại trở đi; các tháng đã qua giữ nguyên làm lịch sử. */
function xoaKhoiTabThang_(ss, ten, phong) {
  var soPhong = 0;
  layTabThang_(ss, false).forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return;
    var cotPhong = sheet.getRange(1, 1, lastRow, 1).getValues();
    for (var i = 0; i < lastRow; i++) {
      if (chuanHoaPhong_(cotPhong[i][0]) !== phong) continue;
      var range = sheet.getRange(i + 1, COT_Q, 1, 12);
      var o = range.getValues()[0];
      var doi = false;
      [0, 4, 8].forEach(function (start) {
        if (chuanHoaTen_(o[start]) !== ten) return;
        for (var k = 0; k < 4; k++) o[start + k] = '';
        doi = true;
      });
      if (doi) {
        range.setValues([o]);
        soPhong += 1;
      }
    }
  });
  return soPhong;
}

/** delete_resident: rời phòng, tài khoản còn. delete_account: xoá hẳn dòng ở tab cá nhân. */
function xoaCuDan_(ss, params, action) {
  var sheet = ss.getSheetByName(TAB_CA_NHAN);
  if (!sheet) return { success: false, action: action, error: 'Không tìm thấy tab ' + TAB_CA_NHAN };
  var rows = sheet.getDataRange().getValues();
  var dong = timDongCuDan_(rows, params.phone, params.name, params.room);
  if (dong === -1) return { success: false, action: action, error: 'Không tìm thấy cư dân trong tab cá nhân' };
  var row = rows[dong];
  var phong = chuanHoaPhong_(row[9]);
  if (String(row[9]).trim().toUpperCase() === 'ADMIN') return { success: false, action: action, error: 'Không thể xoá tài khoản quản trị' };
  var soPhong = phong ? xoaKhoiTabThang_(ss, chuanHoaTen_(row[0]), phong) : 0;
  if (action === 'delete_account') sheet.deleteRow(dong + 1);
  else sheet.getRange(dong + 1, 10).setValue('');
  return { success: true, action: action, roomsChanged: soPhong };
}

/** App lưu hồ sơ vào tab cá nhân rồi đồng bộ sang tab tháng. Ô để trống không xoá dữ liệu cũ. */
function capNhatHoSoCuDan_(ss, params) {
  var sheet = ss.getSheetByName(TAB_CA_NHAN);
  if (!sheet) return { success: false, action: 'update_profile', error: 'Không tìm thấy tab ' + TAB_CA_NHAN };
  var rows = sheet.getDataRange().getValues();
  var dong = timDongCuDan_(rows, params.currentPhone || params.phone, params.name, params.room);
  if (dong === -1) return { success: false, action: 'update_profile', error: 'Không tìm thấy cư dân trong tab cá nhân' };

  var cot = { name: 1, gender: 2, phone: 3, cccd: 4, email: 5, dob: 6, address: 7, plateNumber: 8, vehicleType: 9, emergencyName: 11, emergencyRelation: 12, emergencyPhone: 13 };
  Object.keys(cot).forEach(function (field) {
    var value = String(params[field] === undefined ? '' : params[field]).trim();
    if (!value) return;
    if (field === 'phone') value = chuanHoaSdt_(value);
    if (field === 'cccd') value = chuanHoaCccd_(value);
    var cell = sheet.getRange(dong + 1, cot[field]);
    cell.setNumberFormat('@');
    cell.setValue(value);
  });
  var ketQua = dongBoCuDan_(ss, false, true);
  return { success: true, action: 'update_profile', row: dong + 1, roomsChanged: ketQua.soDong };
}

function markRowPaid() {
  var ss = getSafeSpreadsheet();
  if (!ss) return;
  var sheet = ss.getActiveSheet();
  if (!sheet) return;
  var cell = sheet.getActiveCell();
  if (!cell) {
    showAlertSafely('Vui lòng chọn một ô trên dòng phòng cần đánh dấu!');
    return;
  }
  var row = cell.getRow();
  if (row < 7 || row > 50) {
    showAlertSafely('Vui lòng chọn hàng từ dòng 7 đến dòng 50 (danh sách phòng)!');
    return;
  }
  sheet.getRange(row, 16).setBackground('#d4edda');
  SpreadsheetApp.flush();
  showAlertSafely('✅ Đã đổi Cột P dòng ' + row + ' sang màu xanh lá (Đã thanh toán)!');
}

function markRowUnpaid() {
  var ss = getSafeSpreadsheet();
  if (!ss) return;
  var sheet = ss.getActiveSheet();
  if (!sheet) return;
  var cell = sheet.getActiveCell();
  if (!cell) {
    showAlertSafely('Vui lòng chọn một ô trên dòng phòng cần đánh dấu!');
    return;
  }
  var row = cell.getRow();
  if (row < 7 || row > 50) {
    showAlertSafely('Vui lòng chọn hàng từ dòng 7 đến dòng 50 (danh sách phòng)!');
    return;
  }
  sheet.getRange(row, 16).setBackground('#F8D7DA');
  SpreadsheetApp.flush();
  showAlertSafely('⏳ Đã đổi Cột P dòng ' + row + ' sang màu đỏ pastel (Chưa thanh toán)!');
}

