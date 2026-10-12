import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, 
  Download, 
  Building2,
  Zap, 
  Droplet, 
  Wifi, 
  Sparkles, 
  Bike,
  ReceiptText,
  QrCode,
  Lock
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';

// Reliable Lucide SVG icons mapped to invoice categories
const getCategoryIcon = (type: string) => {
  switch (type) {
    case 'room':
      return <Building2 size={16} className="text-indigo-600 dark:text-indigo-400" />;
    case 'electricity':
      return <Zap size={16} className="text-amber-500 dark:text-amber-400" />;
    case 'water':
      return <Droplet size={16} className="text-sky-500 dark:text-sky-400" />;
    case 'internet':
      return <Wifi size={16} className="text-blue-500 dark:text-blue-400" />;
    case 'service':
      return <Sparkles size={16} className="text-purple-500 dark:text-purple-400" />;
    case 'parking':
      return <Bike size={16} className="text-emerald-500 dark:text-emerald-400" />;
    default:
      return <ReceiptText size={16} className="text-slate-500 dark:text-slate-400" />;
  }
};

export function InvoiceDetailModal() {
  const navigate = useNavigate();
  const { viewingInvoice, closeInvoiceDetailModal, profile, paymentGateStatus } = useApp();

  if (!viewingInvoice) return null;

  const isPaid = viewingInvoice.status === 'paid';
  const isPending = viewingInvoice.status === 'pending';
  const isUnpaid = viewingInvoice.status === 'unpaid';

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('vi-VN');
  };

  const handleDownloadInvoicePDF = () => {
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text('NHA TRO PHONG LAN', 105, 22, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${profile.room?.building || 'Trung Kim'} | Hotline BQL: 0902 371 800`, 105, 28, { align: 'center' });
    
    // Divider line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(20, 33, 190, 33);
    
    // Title
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(`HOA DON DICH VU - THANG ${viewingInvoice.month}`, 105, 43, { align: 'center' });
    
    // Invoice Meta
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Ma hoa don: ${viewingInvoice.id}`, 20, 54);
    doc.text(`Han nop: ${viewingInvoice.dueDate}`, 190, 54, { align: 'right' });
    doc.text(`Khach thue: ${profile.name}`, 20, 61);
    doc.text(`Can ho: ${profile.room.roomNumber} - ${profile.room.building}`, 190, 61, { align: 'right' });
    doc.text(`Trang thai: ${viewingInvoice.status === 'paid' ? 'DA THANH TOAN' : 'CHUA THANH TOAN'}`, 20, 68);
    
    // Table Header
    doc.setFillColor(241, 245, 249);
    doc.rect(20, 75, 170, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('KHOAN MUC PHI', 24, 80.5);
    doc.text('SO TIEN (VND)', 186, 80.5, { align: 'right' });
    
    // Table Rows
    let y = 90;
    viewingInvoice.details.forEach((item) => {
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(item.name, 24, y);
      doc.text(`${item.amount.toLocaleString('vi-VN')} VND`, 186, y, { align: 'right' });
      if (item.metric) {
        y += 4.5;
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(item.metric, 24, y);
      }
      y += 7.5;
      doc.setDrawColor(241, 245, 249);
      doc.line(20, y - 2, 190, y - 2);
    });
    
    // Total Box
    y += 5;
    doc.setFillColor(248, 250, 252);
    doc.rect(20, y, 170, 14, 'F');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('TONG CONG THANH TOAN:', 24, y + 9);
    doc.setFontSize(12);
    doc.text(`${viewingInvoice.total.toLocaleString('vi-VN')} VND`, 186, y + 9, { align: 'right' });
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Cam on quy cu dan da su dung dich vu cua Nha Tro Phong Lan.', 105, 275, { align: 'center' });
    
    doc.save(`HoaDon_PhongLan_${viewingInvoice.month.replace('/', '_')}.pdf`);
  };

  const handlePayNow = () => {
    const id = viewingInvoice.id;
    closeInvoiceDetailModal();
    navigate(`/payment?invoiceId=${id}`);
  };

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={closeInvoiceDetailModal}
    >
      <div 
        className="w-full max-w-lg bg-white dark:bg-[#101726] rounded-3xl border border-white/90 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.35)] flex flex-col max-h-[76vh] sm:max-h-[82vh] mb-14 sm:mb-0 overflow-hidden relative animate-in zoom-in-95 duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
              isUnpaid ? "bg-slate-900 dark:bg-indigo-600 text-white" : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400"
            )}>
              <ReceiptText size={20} className={isUnpaid ? "text-white" : "text-emerald-600 dark:text-emerald-400"} />
            </div>
            <div>
              <h3 className="type-h3 text-slate-900 dark:text-white font-bold">Hóa đơn Tháng {viewingInvoice.month}</h3>
              <p className="type-caption text-slate-400 font-num">Mã số: {viewingInvoice.id}</p>
            </div>
          </div>

          <button 
            type="button"
            onClick={closeInvoiceDetailModal}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 text-xs">
          
          {/* Summary Box */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 dark:bg-[#162032] border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Tổng tiền</span>
              <span className="type-h2 font-num font-bold text-slate-900 dark:text-white">
                {formatCurrency(viewingInvoice.total)} ₫
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Hạn thanh toán</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 font-num">{viewingInvoice.dueDate}</span>
            </div>
          </div>

          {/* Details breakdown */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Chi tiết khoản phí</span>
            
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-[#162032]">
              {viewingInvoice.details.map((detail, idx) => {
                return (
                  <div key={idx} className="p-2.5 sm:p-3 flex items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        {getCategoryIcon(detail.type)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 dark:text-slate-100 truncate leading-tight">{detail.name}</p>
                        {detail.metric && (
                          <p className="text-[10px] text-slate-400 font-num mt-0.5">{detail.metric}</p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold text-slate-900 dark:text-white font-num">
                        {formatCurrency(detail.amount)} ₫
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Note */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#162032] border border-transparent dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
            {isPaid && (
              <p className="text-emerald-700 dark:text-emerald-400 font-medium">✓ Đã thanh toán đầy đủ ({viewingInvoice.paidAt || 'Đã ghi nhận trên Google Sheet'}).</p>
            )}
            {isPending && (
              <p className="text-amber-700 dark:text-amber-400 font-medium">⏳ Đã ghi nhận giao dịch. Đang chờ Ban Quản Lý đối soát và cập nhật trên Google Sheet.</p>
            )}
            {isUnpaid && (
              <p>• Hóa đơn đã được gửi qua ứng dụng. Vui lòng thanh toán trước hạn {viewingInvoice.dueDate}.</p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-3.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#101726] flex items-center justify-between gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={handleDownloadInvoicePDF}
            className="flex-1 sm:flex-initial soft-button text-xs py-2.5 px-3 sm:px-4 flex items-center justify-center gap-1.5 text-slate-700 dark:text-slate-200 cursor-pointer font-semibold active:scale-95 transition-all"
            title="Tải hóa đơn dạng tệp PDF"
          >
            <Download size={14} />
            <span className="truncate">Tải hóa đơn (PDF)</span>
          </button>

          {isUnpaid ? (
            <button
              type="button"
              onClick={handlePayNow}
              className="flex-1 sm:flex-initial primary-button text-xs py-2.5 px-3 sm:px-4 flex items-center justify-center gap-1.5 shadow-sm font-bold cursor-pointer active:scale-95 transition-all"
              title={paymentGateStatus === 'STOP' ? 'Cổng thanh toán đang tạm đóng' : 'Quét mã VietQR thanh toán'}
            >
              {paymentGateStatus === 'STOP' ? (
                <>
                  <Lock size={14} className="text-amber-300" />
                  <span className="truncate">Thanh toán (Cổng đóng)</span>
                </>
              ) : (
                <>
                  <QrCode size={14} />
                  <span className="truncate">Thanh toán ngay</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={closeInvoiceDetailModal}
              className="soft-button text-xs py-2.5 px-5 text-slate-700 dark:text-slate-200 cursor-pointer font-medium"
            >
              Đóng
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
