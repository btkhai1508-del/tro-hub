import { NotificationItem } from '../context/AppContext';

export function subscribeRealtimeRoom(
  _roomNumber: string,
  _onUpdate: (data: any) => void
): () => void {
  return () => {};
}

export function subscribeRealtimeAllRooms(
  _onUpdate: (rooms: any[]) => void
): () => void {
  return () => {};
}

export async function pushNotificationToFirestore(
  _notification: Partial<NotificationItem> & {
    target?: string;
    customRooms?: string[];
    scheduledAt?: string | null;
    createdAt?: string;
  }
): Promise<{ success: boolean }> {
  return { success: true };
}

export function subscribeRealtimeNotifications(
  _roomNumber: string,
  _building: string,
  _onUpdate: (notifications: NotificationItem[]) => void
): () => void {
  return () => {};
}

export async function uploadContractPdf(
  _pdfBlob: Blob,
  _fileName: string
): Promise<string> {
  return '';
}
