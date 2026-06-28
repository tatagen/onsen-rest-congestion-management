/**
 * Types for the Osen Rest Area Congestion Management Application
 */

export interface Cushion {
  id: string;
  label: string;
  x: number; // Percentage coordinate (0-100)
  y: number; // Percentage coordinate (0-100)
  groupId: string | null; // CSS/Visual grouping
  customerId: string | null; // Associated customer if seated
}

export interface Customer {
  id: string;
  ticketNumber: string; // e.g., "#001"（受付番号を手動指定した場合はその文字列）
  seq: number; // Sequential number（手動指定の番号とは関係なく常に連番で増加）
  groupSize: number; // Number of people
  status: 'waiting' | 'called' | 'moving' | 'seated' | 'completed' | 'canceled';
  seatedTime: string | null; // e.g., "13:15"
  exitTimePlanned: string | null; // e.g., "14:15" (entry + 60 minutes)
  createdAt: number; // Timestamp epoch
  updatedAt?: number; // 完了・取消などの最終更新時刻（履歴の並び替え・表示に使用）
}

export interface AvailabilitySlot {
  people: number;
  count: number;
}

export interface SystemConfig {
  capacity: number; // 案内可能人数
  callingStopped: boolean; // 呼び出しストップ
  lastResetDate: string; // YYYY-MM-DD
  nextSeq: number; // Counter for tickets starting at 1
  availabilitySlots?: AvailabilitySlot[];
}

export interface RoomPoint {
  x: number; // パーセント座標 (0-100)
  y: number; // パーセント座標 (0-100)
}

export interface RoomConfig {
  widthM: number; // 部屋の幅（メートル）
  heightM: number; // 部屋の奥行き（メートル）
  cushionSizeM: number; // 座布団の大きさ（メートル）
  shapePoints: RoomPoint[]; // 部屋の形状（多角形の頂点、パーセント座標）
}
