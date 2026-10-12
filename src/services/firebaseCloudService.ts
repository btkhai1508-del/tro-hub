import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  query, 
  orderBy, 
  onSnapshot, 
  Unsubscribe 
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  uploadString 
} from 'firebase/storage';
import { db, storageBucket } from '../lib/firebase';
import { NotificationItem } from '../types';
import { canonicalRoomId } from './googleSheetSyncService';

/**
 * -------------------------------------------------------------
 * REALTIME ROOMS SYNCHRONIZATION (Instant Firestore listeners)
 * -------------------------------------------------------------
 */

export function subscribeRealtimeRoom(
  roomNumber: string,
  onUpdate: (data: any) => void
): Unsubscribe {
  const cleanRoom = canonicalRoomId(roomNumber);
  const roomDocRef = doc(db, 'rooms', cleanRoom);
  return onSnapshot(
    roomDocRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data());
      }
    },
    (err) => {
      console.warn('[Firestore] subscribeRealtimeRoom error:', err);
    }
  );
}

export function subscribeRealtimeAllRooms(
  onUpdate: (rooms: any[]) => void
): Unsubscribe {
  const roomsCol = collection(db, 'rooms');
  return onSnapshot(
    roomsCol,
    (snap) => {
      if (!snap.empty) {
        const roomMap = new Map<string, any>();
        snap.docs.forEach((d) => {
          const data = d.data();
          const cleanKey = canonicalRoomId(data.room || d.id);
          if (!cleanKey) return;
          if (!roomMap.has(cleanKey) || !d.id.includes('_')) {
            roomMap.set(cleanKey, {
              room: cleanKey,
              name: data.name || data.nguoi1 || `Phòng ${cleanKey}`,
              phone: data.phone || data.sdt1 || '',
              status: data.paymentStatus || data.status || 'unpaid',
              statusText: data.statusText || (data.paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng'),
              paymentStatus: data.paymentStatus || data.status || 'unpaid',
              statusHTML: data.paymentStatus === 'paid'
                ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
                : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>',
              tongTien: Number(data.tongTien) || 0,
              tienPhong: Number(data.tienPhong) || 0,
              tienDien: Number(data.tienDien) || 0,
              tienNuoc: Number(data.tienNuoc) || 0,
              tienRac: Number(data.tienRac) || 0,
              tienNet: Number(data.tienNet) || 0,
              tienXe: Number(data.tienXe) || 0,
              tienKhac: Number(data.tienKhac) || 0,
              tienCoc: Number(data.tienCoc) || 0,
              dienCu: Number(data.dienCu) || 0,
              dienMoi: Number(data.dienMoi) || 0,
              dienUsed: Number(data.dienUsed) || 0,
              nuocCu: Number(data.nuocCu) || 0,
              nuocMoi: Number(data.nuocMoi) || 0,
              nuocUsed: Number(data.nuocUsed) || 0,
              nguoi1: data.nguoi1 || '',
              cccd1: data.cccd1 || '',
              sdt1: data.sdt1 || '',
              xe1: data.xe1 || '',
              nguoi2: data.nguoi2 || '',
              cccd2: data.cccd2 || '',
              sdt2: data.sdt2 || '',
              xe2: data.xe2 || '',
              nguoi3: data.nguoi3 || '',
              cccd3: data.cccd3 || '',
              sdt3: data.sdt3 || '',
              xe3: data.xe3 || '',
              soNguoi: Number(data.soNguoi) || 1,
              soXe: Number(data.soXe) || 1,
              ...data
            });
          }
        });
        onUpdate(Array.from(roomMap.values()));
      }
    },
    (err) => {
      console.warn('[Firestore] subscribeRealtimeAllRooms error:', err);
    }
  );
}

export interface FirestoreNotificationDoc {
  id: string;
  title: string;
  desc: string;
  time: string;
  createdAt: string;
  type: 'invoice' | 'alert' | 'success' | 'info';
  target: 'ALL' | 'LVC' | 'TRUNG_KIM' | 'CUSTOM';
  customRooms?: string[];
  scheduledAt?: string | null;
  sender?: string;
  unread?: boolean;
}

/**
 * Save notification to Firestore collection 'notifications'
 */
export async function pushNotificationToFirestore(notif: FirestoreNotificationDoc): Promise<void> {
  try {
    const docRef = doc(db, 'notifications', notif.id);
    await setDoc(docRef, {
      ...notif,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[Firestore] Could not push notification directly (will use backend fallback):', error);
  }
}

/**
 * Subscribe to Realtime Notification updates from Firestore
 */
export function subscribeRealtimeNotifications(
  roomNumber: string,
  building: string,
  onUpdate: (notifications: NotificationItem[]) => void
): Unsubscribe {
  const notifsCol = collection(db, 'notifications');
  const q = query(notifsCol, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: FirestoreNotificationDoc[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as FirestoreNotificationDoc);
      });

      const now = Date.now();
      const room = (roomNumber || '').trim().toUpperCase();
      const bld = (building || '').trim().toUpperCase();

      const filtered = items.filter((item) => {
        if (item.scheduledAt) {
          const schedTime = new Date(item.scheduledAt).getTime();
          if (!isNaN(schedTime) && schedTime > now) return false;
        }
        if (item.target === 'ALL') return true;
        if (item.target === 'LVC') {
          return room.includes('LVC') || bld.includes('LÊ VĂN CHÍ') || bld.includes('LVC');
        }
        if (item.target === 'TRUNG_KIM') {
          return bld.includes('TRUNG KIM') || (!room.includes('LVC') && !bld.includes('LVC'));
        }
        if (item.target === 'CUSTOM') {
          if (!Array.isArray(item.customRooms) || item.customRooms.length === 0) return true;
          return item.customRooms.some((r) => {
            const cleanR = r.trim().toUpperCase();
            return cleanR === room || room.includes(cleanR) || cleanR.includes(room);
          });
        }
        return true;
      });

      const mapped: NotificationItem[] = filtered.map((f) => ({
        id: f.id,
        title: f.title,
        desc: f.desc,
        time: f.time,
        type: f.type,
        sender: f.sender || 'Ban Quản Lý EcoStay',
        unread: f.unread !== undefined ? f.unread : true
      }));

      onUpdate(mapped);
    },
    (err) => {
      console.warn('[Firestore] Realtime subscription listener error (fallback to polling):', err);
    }
  );
}

/**
 * -------------------------------------------------------------
 * 2. CLOUD STORAGE: FILE & MEDIA UPLOADS
 * -------------------------------------------------------------
 */

/**
 * Upload Contract / CT01 PDF blob to Firebase Cloud Storage and return public download URL
 */
export async function uploadContractPdfToStorage(
  pdfBlob: Blob,
  roomNumber: string,
  docType: 'contract' | 'ct01' = 'contract'
): Promise<string> {
  const cleanRoom = (roomNumber || 'GENERIC').replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = Date.now();
  const filePath = `contracts/${cleanRoom}/${docType}_${cleanRoom}_${timestamp}.pdf`;
  const storageRef = ref(storageBucket, filePath);

  const snapshot = await uploadBytes(storageRef, pdfBlob, {
    contentType: 'application/pdf',
    customMetadata: {
      room: roomNumber,
      docType,
      uploadedAt: new Date().toISOString()
    }
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl;
}

/**
 * Upload Incident / Utility meter image (DataURL or Blob) to Firebase Cloud Storage
 */
export async function uploadImageToStorage(
  imageFileOrDataUrl: Blob | string,
  folder: 'meters' | 'incidents' | 'plates' = 'meters',
  fileName?: string
): Promise<string> {
  const timestamp = Date.now();
  const effectiveName = fileName || `img_${timestamp}.jpg`;
  const filePath = `${folder}/${effectiveName}`;
  const storageRef = ref(storageBucket, filePath);

  if (typeof imageFileOrDataUrl === 'string') {
    // DataURL base64
    const snapshot = await uploadString(storageRef, imageFileOrDataUrl, 'data_url');
    return await getDownloadURL(snapshot.ref);
  } else {
    // Blob or File
    const snapshot = await uploadBytes(storageRef, imageFileOrDataUrl, {
      contentType: imageFileOrDataUrl.type || 'image/jpeg'
    });
    return await getDownloadURL(snapshot.ref);
  }
}
