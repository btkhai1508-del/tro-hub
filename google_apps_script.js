/**
 * GOOGLE APPS SCRIPT CHO NHÀ TRỌ PHONG LAN (TRO-HUB)
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
      var data = targetSheet.getDataRange().getValues();

      for (var r = 1; r < data.length; r++) {
        var colA = String(data[r][0] || "").trim(); // Cột A
        var colB = String(data[r][1] || "").trim(); // Cột B
        
        var matches = false;
        [colA, colB].forEach(function(val) {
          if (!val) return;
          if (val.toLowerCase() === targetRoom.toLowerCase()) matches = true;
          if (val.replace(/\D/g, "") && targetRoom.replace(/\D/g, "") && val.replace(/\D/g, "") === targetRoom.replace(/\D/g, "")) matches = true;
          if (val.replace(/^(P\.|P\s*)/i, "").trim().toLowerCase() === targetRoom.replace(/^(P\.|P\s*)/i, "").trim().toLowerCase()) matches = true;
        });

        if (matches) {
          var cellP = targetSheet.getRange(r + 1, 16); // Cột P (cột 16)
          if (isPaid) {
            // Xác nhận thu tiền: Tô highlight cột P tương ứng chuyển sang màu xanh lá
            cellP.setBackground("#b6d7a8"); // Màu xanh lá Google Sheets tiêu chuẩn (Light green)
          } else {
            // Hủy thu tiền: Chuyển lại màu đỏ pastel chưa đóng
            cellP.setBackground("#F8D7DA");
          }
          SpreadsheetApp.flush();
          return createJsonResponse({
            success: true,
            message: "Đã cập nhật highlight cột P phòng " + targetRoom + " sang " + (isPaid ? "màu xanh lá (#b6d7a8)" : "màu đỏ pastel (#F8D7DA)"),
            row: r + 1,
            color: isPaid ? "#b6d7a8" : "#F8D7DA",
            status: isPaid ? "paid" : "unpaid"
          });
        }
      }
      return createJsonResponse({ success: false, error: "Không tìm thấy phòng " + targetRoom + " trong sheet " + targetSheet.getName() });
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
