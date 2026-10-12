/**
 * GOOGLE APPS SCRIPT CHO ECOSTAY TRO-HUB
 * Tự động đồng bộ 2 chiều:
 * 1. Ô Q2: Đóng/Mở cổng thanh toán (START / STOP)
 * 2. Tab "Notifications": Lưu thông báo từ Admin (Cột A: Date, B: Phòng, C: Loại, D: Nội dung)
 * 3. Cập nhật thanh toán (Cột P: ĐÃ ĐÓNG / CHƯA ĐÓNG)
 * 4. Cập nhật chỉ số điện/nước
 */

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
    // ----------------------------------------------------
    if (action === "update_payment") {
      var monthTab = String(params.month || "").replace(/\D/g, "");
      var targetSheet = ss.getSheetByName(params.month) || ss.getSheetByName(monthTab) || ss.getSheetByName("Tháng " + params.month);
      if (!targetSheet) {
        return createJsonResponse({ success: false, error: "Không tìm thấy sheet tháng: " + params.month });
      }

      var targetRoom = String(params.room || "").trim();
      var newStatus = params.status === "paid" ? "ĐÃ ĐÓNG" : "CHƯA ĐÓNG";
      var data = targetSheet.getDataRange().getValues();

      for (var r = 1; r < data.length; r++) {
        var rowRoom = String(data[r][1] || "").trim(); // Cột B: Phòng
        if (rowRoom.toLowerCase() === targetRoom.toLowerCase() || 
            rowRoom.replace(/\D/g, "") === targetRoom.replace(/\D/g, "")) {
          targetSheet.getRange(r + 1, 16).setValue(newStatus); // Cột P (cột 16)
          SpreadsheetApp.flush();
          return createJsonResponse({
            success: true,
            message: "Đã cập nhật trạng thái phòng " + targetRoom + " thành " + newStatus,
            row: r + 1,
            status: newStatus
          });
        }
      }
      return createJsonResponse({ success: false, error: "Không tìm thấy phòng " + targetRoom });
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
