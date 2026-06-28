import React, { useState, useRef, useEffect } from 'react';
import { X, Info, History, RotateCcw } from 'lucide-react';
import { RoomConfig, RoomPoint, Customer, SystemConfig } from '../types';
import { db, doc, updateDoc, collection, getDocs, setDoc } from '../firebase';

const HISTORY_LIMIT = 50;

interface AdminPanelProps {
  roomConfig: RoomConfig;
  config: SystemConfig;
  onClose: () => void;
}

const RECT_PRESET: RoomPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const LSHAPE_PRESET: RoomPoint[] = [
  { x: 0, y: 0 },
  { x: 65, y: 0 },
  { x: 65, y: 60 },
  { x: 100, y: 60 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

// 辺の上に乗っている最も近い点を求める（頂点をクリックで追加するための投影計算）
function projectOnSegment(p: RoomPoint, a: RoomPoint, b: RoomPoint): RoomPoint {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return a;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export default function AdminPanel({ roomConfig, config, onClose }: AdminPanelProps) {
  const [points, setPoints] = useState<RoomPoint[]>(roomConfig.shapePoints);
  const pointsRef = useRef<RoomPoint[]>(points);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingIndex = useRef<number | null>(null);

  const [historyList, setHistoryList] = useState<Customer[]>([]);
  const [canceledList, setCanceledList] = useState<Customer[]>([]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  // Firestoreから最新の形状が届いたら（ドラッグ中でない限り）反映する
  useEffect(() => {
    if (draggingIndex.current === null) {
      setPoints(roomConfig.shapePoints);
    }
  }, [roomConfig.shapePoints]);

  // 管理画面を開いたタイミングで入室履歴・取消履歴を読み込む（参考サイトの loadAdmin() と同じ仕組み）
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const snap = await getDocs(collection(db, 'customers'));
      const completed: Customer[] = [];
      const canceled: Customer[] = [];
      snap.forEach((d: any) => {
        const cust = d.data() as Customer;
        if (cust.status === 'completed') completed.push(cust);
        else if (cust.status === 'canceled') canceled.push(cust);
      });
      const byRecency = (a: Customer, b: Customer) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      setHistoryList(completed.sort(byRecency).slice(0, HISTORY_LIMIT));
      setCanceledList(canceled.sort(byRecency).slice(0, HISTORY_LIMIT));
    } catch (err) {
      console.error('Error loading history', err);
    }
  };

  // 履歴から「移動中」または「待機中」へ復元する（元の受付番号・人数を引き継いだ新しいチケットとして再作成）
  const restoreCustomer = async (original: Customer, targetStatus: 'moving' | 'waiting') => {
    try {
      const newId = `ticket-${Date.now()}`;
      const restored: Customer = {
        id: newId,
        ticketNumber: original.ticketNumber,
        seq: original.seq,
        groupSize: original.groupSize,
        status: targetStatus,
        seatedTime: null,
        exitTimePlanned: null,
        createdAt: Date.now(),
      };
      await setDoc(doc(db, 'customers', newId), restored);
      setHistoryList(prev => prev.filter(c => c.id !== original.id));
      setCanceledList(prev => prev.filter(c => c.id !== original.id));
    } catch (err) {
      console.error('Error restoring customer', err);
    }
  };

  const saveRoomConfig = async (partial: Partial<RoomConfig>) => {
    try {
      await updateDoc(doc(db, 'config', 'room'), partial);
    } catch (err) {
      console.error('Error saving room config', err);
    }
  };

  const handleCapacityChange = async (raw: number) => {
    const clean = Math.max(1, Math.min(200, isNaN(raw) ? config.capacity : raw));
    try {
      await updateDoc(doc(db, 'config', 'global'), { capacity: clean });
    } catch (err) {
      console.error('Error saving capacity', err);
    }
  };

  const handleCushionSizeChange = (raw: number) => {
    const clean = Math.max(0.1, Math.min(2, isNaN(raw) ? roomConfig.cushionSizeM : raw));
    saveRoomConfig({ cushionSizeM: clean });
  };

  const applyShapePreset = (preset: RoomPoint[]) => {
    setPoints(preset);
    saveRoomConfig({ shapePoints: preset });
  };

  const toRelativePoint = (clientX: number, clientY: number): RoomPoint | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 0), 100);
    const y = Math.min(Math.max(((clientY - rect.top) / rect.height) * 100, 0), 100);
    return { x, y };
  };

  // 頂点のドラッグ移動
  const handleVertexPointerDown = (index: number, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    draggingIndex.current = index;
  };

  const handleContainerPointerMove = (e: React.PointerEvent) => {
    if (draggingIndex.current === null) return;
    const p = toRelativePoint(e.clientX, e.clientY);
    if (!p) return;
    const idx = draggingIndex.current;
    setPoints(prev => prev.map((pt, i) => (i === idx ? p : pt)));
  };

  const handleContainerPointerUp = () => {
    if (draggingIndex.current === null) return;
    draggingIndex.current = null;
    saveRoomConfig({ shapePoints: pointsRef.current });
  };

  // 頂点をダブルクリックで削除（最低3点は残す＝多角形として成立する最小数）
  const handleVertexDoubleClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (points.length <= 3) {
      alert('部屋の形状には最低3つの頂点が必要です');
      return;
    }
    const next = points.filter((_, i) => i !== index);
    setPoints(next);
    saveRoomConfig({ shapePoints: next });
  };

  // 辺の近くをクリックして新しい頂点を追加（凹凸のある自由な形状を作るため）
  const handleEdgeClick = (e: React.MouseEvent) => {
    const p = toRelativePoint(e.clientX, e.clientY);
    if (!p) return;

    let bestIndex = -1;
    let bestDist = Infinity;
    let bestPoint: RoomPoint = p;

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const proj = projectOnSegment(p, a, b);
      const dist = Math.hypot(proj.x - p.x, proj.y - p.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
        bestPoint = proj;
      }
    }

    if (bestIndex === -1 || bestDist > 6) return;

    const next = [...points];
    next.splice(bestIndex + 1, 0, bestPoint);
    setPoints(next);
    saveRoomConfig({ shapePoints: next });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded max-w-lg w-full p-6 shadow-2xl border border-natural-border flex flex-col gap-5 max-h-[90vh] overflow-y-auto text-natural-wood">
        <div className="flex items-center justify-between border-b-2 border-natural-clay pb-2">
          <span className="text-sm font-bold text-natural-wood tracking-wide">管理設定 - 部屋・座布団のサイズとレイアウト</span>
          <button onClick={onClose} className="text-natural-clay hover:text-natural-wood cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* 休憩室の定員設定 */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-natural-clay">休憩室 定員設定（案内可能人数）</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleCapacityChange(config.capacity - 1)}
              className="w-10 h-10 rounded bg-[#FAF7F2] border border-natural-border text-natural-wood font-bold text-lg hover:bg-natural-khaki cursor-pointer"
            >−</button>
            <input
              type="number"
              min="1"
              max="200"
              value={config.capacity}
              onChange={(e) => handleCapacityChange(parseInt(e.target.value, 10))}
              className="w-20 px-1.5 py-1.5 text-center text-sm border border-natural-border rounded font-bold font-mono focus:outline-none focus:border-natural-clay bg-[#FAF7F2]/40"
            />
            <button
              type="button"
              onClick={() => handleCapacityChange(config.capacity + 1)}
              className="w-10 h-10 rounded bg-natural-clay text-white font-bold text-lg hover:bg-natural-clay/90 cursor-pointer"
            >+</button>
            <span className="text-xs font-bold text-natural-wood">名まで</span>
          </div>
        </div>

        {/* 座布団の大きさ（メートル指定） */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-natural-clay">座布団の大きさ（メートル指定）</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0.1"
              max="2"
              step="0.05"
              value={roomConfig.cushionSizeM}
              onChange={(e) => handleCushionSizeChange(parseFloat(e.target.value))}
              className="w-20 px-1.5 py-1 text-sm border border-natural-border rounded font-bold font-mono focus:outline-none focus:border-natural-clay bg-[#FAF7F2]/40"
            />
            <span className="text-xs">m 角</span>
          </div>
        </div>

        {/* 部屋の形状エディタ */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-natural-clay">部屋の形状（長方形以外も作成できます）</label>

          <div className="flex items-center gap-2">
            <button
              onClick={() => applyShapePreset(RECT_PRESET)}
              className="px-2.5 py-1.5 bg-[#FAF7F2] border border-natural-border/60 hover:bg-natural-khaki rounded text-[11px] font-bold cursor-pointer"
            >
              長方形にリセット
            </button>
            <button
              onClick={() => applyShapePreset(LSHAPE_PRESET)}
              className="px-2.5 py-1.5 bg-[#FAF7F2] border border-natural-border/60 hover:bg-natural-khaki rounded text-[11px] font-bold cursor-pointer"
            >
              L字型サンプルを適用
            </button>
          </div>

          <div
            ref={containerRef}
            onPointerMove={handleContainerPointerMove}
            onPointerUp={handleContainerPointerUp}
            className="relative w-full border-2 border-dashed border-natural-border rounded bg-natural-sand touch-none select-none"
            style={{ aspectRatio: '4 / 3' }}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full cursor-copy"
              onClick={handleEdgeClick}
            >
              <polygon
                points={points.map(p => `${p.x},${p.y}`).join(' ')}
                fill="rgba(168,144,122,0.18)"
                stroke="#A8907A"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {points.map((p, i) => (
              <div
                key={i}
                onPointerDown={(e) => handleVertexPointerDown(i, e)}
                onDoubleClick={(e) => handleVertexDoubleClick(i, e)}
                title="ドラッグで移動・ダブルクリックで削除"
                className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-natural-clay border-2 border-white shadow cursor-move touch-none"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              />
            ))}
          </div>

          <div className="bg-[#FAF7F2] border border-natural-border/50 rounded p-2.5 flex items-start gap-1.5 text-[11px] text-natural-wood">
            <Info size={14} className="shrink-0 text-natural-clay mt-0.5" />
            <span>頂点（丸印）をドラッグして形を変更できます。辺の上をクリックすると頂点を追加、頂点をダブルクリックすると削除できます（最低3点）。</span>
          </div>
        </div>

        {/* 入室履歴・取消履歴 + 復元機能 */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-natural-clay flex items-center gap-1.5">
            <History size={14} />
            入室履歴・取消履歴(最近{HISTORY_LIMIT}件)
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-natural-wood">入室履歴</span>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto border border-natural-border rounded p-2 bg-[#FAF7F2]">
              {historyList.length === 0 ? (
                <span className="text-natural-clay text-[11px] text-center italic py-1.5">履歴はありません</span>
              ) : (
                historyList.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-2 p-1.5 bg-white border border-natural-border/60 rounded text-[11px]">
                    <span className="font-mono font-bold">{item.ticketNumber} / {item.groupSize}人</span>
                    <button
                      onClick={() => restoreCustomer(item, 'moving')}
                      className="flex items-center gap-1 px-2 py-1 bg-natural-moss hover:bg-natural-moss/90 text-white rounded text-[10px] font-bold cursor-pointer"
                    >
                      <RotateCcw size={11} />
                      「移動中」に復元
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-natural-wood">取消履歴</span>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto border border-natural-border rounded p-2 bg-[#FAF7F2]">
              {canceledList.length === 0 ? (
                <span className="text-natural-clay text-[11px] text-center italic py-1.5">取消履歴はありません</span>
              ) : (
                canceledList.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-2 p-1.5 bg-white border border-natural-border/60 rounded text-[11px]">
                    <span className="font-mono font-bold">{item.ticketNumber} / {item.groupSize}人</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => restoreCustomer(item, 'moving')}
                        className="flex items-center gap-1 px-2 py-1 bg-natural-moss hover:bg-natural-moss/90 text-white rounded text-[10px] font-bold cursor-pointer"
                      >
                        <RotateCcw size={11} />
                        移動中
                      </button>
                      <button
                        onClick={() => restoreCustomer(item, 'waiting')}
                        className="flex items-center gap-1 px-2 py-1 bg-natural-clay hover:bg-natural-clay/90 text-white rounded text-[10px] font-bold cursor-pointer"
                      >
                        <RotateCcw size={11} />
                        待機中
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="py-2 bg-natural-olive hover:bg-natural-olive/90 text-white rounded text-xs font-extrabold transition-all cursor-pointer shadow-md"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
