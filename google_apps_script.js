/**
 * GOOGLE APPS SCRIPT CHO NHÀ TRỌ PHONG LAN (TRO-HUB)
 * Tự động đồng bộ 2 chiều:
 * 1. Ô Q2: Đóng/Mở cổng thanh toán (START / STOP)
 * 2. Tab "Notifications": Lưu thông báo từ Admin (Cột A: Date, B: Phòng, C: Loại, D: Nội dung)
 * 3. Cập nhật thanh toán (Cột P: ĐÃ ĐÓNG / CHƯA ĐÓNG)
 * 4. Cập nhật chỉ số điện/nước
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

      notifSheet.appendRow([dateVal, roomVal, typeVal, contentVal]);
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
    .addItem('✅ 1. Đánh dấu ĐÃ THANH TOÁN (Màu xanh lá Cột P)', 'markRowPaid')
    .addItem('⏳ 2. Đánh dấu CHƯA THANH TOÁN (Màu đỏ Cột P)', 'markRowUnpaid')
    .addToUi();
}

function markRowPaid() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveCell().getRow();
  if (row < 7 || row > 50) {
    SpreadsheetApp.getUi().alert('Vui lòng chọn hàng từ dòng 7 đến dòng 50 (danh sách phòng)!');
    return;
  }
  sheet.getRange(row, 16).setBackground('#d4edda');
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ Đã đổi Cột P dòng ' + row + ' sang màu xanh lá (Đã thanh toán)!');
}

function markRowUnpaid() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveCell().getRow();
  if (row < 7 || row > 50) {
    SpreadsheetApp.getUi().alert('Vui lòng chọn hàng từ dòng 7 đến dòng 50 (danh sách phòng)!');
    return;
  }
  sheet.getRange(row, 16).setBackground('#F8D7DA');
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('⏳ Đã đổi Cột P dòng ' + row + ' sang màu đỏ pastel (Chưa thanh toán)!');
}
