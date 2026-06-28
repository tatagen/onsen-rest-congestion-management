import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, getDocs, setDoc, writeBatch, updateDoc, db } from './firebase';
import { Cushion, Customer, SystemConfig, RoomConfig, AvailabilitySlot } from './types';
import Header from './components/Header';
import CushionMap from './components/CushionMap';
import QueueSidebar from './components/QueueSidebar';
import AdminPanel from './components/AdminPanel';
import { Users, Info, X } from 'lucide-react';

// 部屋の形状デフォルト（長方形の四隅）
const DEFAULT_SHAPE_POINTS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

export default function App() {
  const [cushions, setCushions] = useState<Cushion[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [roomConfig, setRoomConfig] = useState<RoomConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customGroupSize, setCustomGroupSize] = useState<number>(1);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  const [pickRequestId, setPickRequestId] = useState<string | null>(null);

  // Helper to format date TODAY in local timezone YYYY-MM-DD
  const getTodayLocalDateString = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Seeding default 12 cushions in elegant traditional layout
  const seedDefaultCushions = async () => {
    const defaultCushions: Cushion[] = [
      // Row 1 (Top Left paired cushions) - e.g., G1
      { id: 'cushion-1', label: '01', x: 20, y: 25, groupId: 'group-default-1', customerId: null },
      { id: 'cushion-2', label: '02', x: 32, y: 25, groupId: 'group-default-1', customerId: null },
      
      // Row 2 (Bottom Left paired cushions) - e.g., G2
      { id: 'cushion-3', label: '03', x: 20, y: 70, groupId: 'group-default-2', customerId: null },
      { id: 'cushion-4', label: '04', x: 32, y: 70, groupId: 'group-default-2', customerId: null },

      // Middle Column (Solo space)
      { id: 'cushion-5', label: '05', x: 55, y: 20, groupId: null, customerId: null },
      { id: 'cushion-6', label: '06', x: 55, y: 45, groupId: null, customerId: null },
      { id: 'cushion-7', label: '07', x: 55, y: 70, groupId: null, customerId: null },

      // Right Column (Solo Tatami spots)
      { id: 'cushion-8', label: '08', x: 78, y: 20, groupId: null, customerId: null },
      { id: 'cushion-9', label: '09', x: 78, y: 45, groupId: null, customerId: null },
      { id: 'cushion-10', label: '10', x: 78, y: 70, groupId: null, customerId: null },

      // paired cushions center bottom - G3
      { id: 'cushion-11', label: '11', x: 42, y: 92, groupId: 'group-default-3', customerId: null },
      { id: 'cushion-12', label: '12', x: 54, y: 92, groupId: 'group-default-3', customerId: null },
    ];

    const batch = writeBatch(db);
    defaultCushions.forEach(c => {
      batch.set(doc(db, 'cushions', c.id), c);
    });
    await batch.commit();
  };

  // Seeding default configuration
  const seedDefaultConfig = async () => {
    const todayStr = getTodayLocalDateString();
    const defaultConfig: SystemConfig = {
      capacity: 20,
      callingStopped: false,
      lastResetDate: todayStr,
      nextSeq: 1,
    };
    await setDoc(doc(db, 'config', 'global'), defaultConfig);
  };

  // Seeding default room layout configuration (部屋・座布団サイズの初期設定)
  const seedDefaultRoomConfig = async () => {
    const defaultRoomConfig: RoomConfig = {
      widthM: 6,
      heightM: 4,
      cushionSizeM: 0.6,
      shapePoints: DEFAULT_SHAPE_POINTS,
    };
    await setDoc(doc(db, 'config', 'room'), defaultRoomConfig);
  };

  // Realtime full database stream listeners (1-2s syncing!)
  useEffect(() => {
    let unsubscribeCushions = () => {};
    let unsubscribeCustomers = () => {};
    let unsubscribeConfig = () => {};
    let unsubscribeRoomConfig = () => {};

    const initializeDataStreams = async () => {
      try {
        // 1. Listen to global configuration
        unsubscribeConfig = onSnapshot(doc(db, 'config', 'global'), async (configSnap) => {
          if (!configSnap.exists()) {
            await seedDefaultConfig();
            return;
          }

          const currentConfig = configSnap.data() as SystemConfig;
          setConfig(currentConfig);

          // 4.1 AUTOMATIC DAILY DATE RESET (自動日付切り替えリセット処理)
          const todayStr = getTodayLocalDateString();
          if (currentConfig.lastResetDate !== todayStr) {
            console.log(`Date changed detected: last reset on ${currentConfig.lastResetDate}, today is ${todayStr}. Executing automatic daily reset...`);
            await performSystemReset(todayStr, currentConfig.capacity);
          }
        });

        // 1.5 Listen to room layout configuration (部屋・座布団サイズ設定)
        unsubscribeRoomConfig = onSnapshot(doc(db, 'config', 'room'), async (roomConfigSnap) => {
          if (!roomConfigSnap.exists()) {
            await seedDefaultRoomConfig();
            return;
          }
          setRoomConfig(roomConfigSnap.data() as RoomConfig);
        });

        // 2. Listen to cushions
        unsubscribeCushions = onSnapshot(collection(db, 'cushions'), async (cushionsSnap) => {
          if (cushionsSnap.empty) {
            await seedDefaultCushions();
            return;
          }

          const items: Cushion[] = [];
          cushionsSnap.forEach(snap => {
            items.push(snap.data() as Cushion);
          });
          // Sort them by label or ID so they retain order in lists
          items.sort((a, b) => a.label.localeCompare(b.label));
          setCushions(items);
        });

        // 3. Listen to customers (completed/canceled は履歴として残すが、アクティブ一覧からは除外する)
        unsubscribeCustomers = onSnapshot(collection(db, 'customers'), (customersSnap) => {
          const items: Customer[] = [];
          customersSnap.forEach(snap => {
            const cust = snap.data() as Customer;
            if (cust.status !== 'completed' && cust.status !== 'canceled') {
              items.push(cust);
            }
          });
          setCustomers(items);
          setLoading(false);
        });

      } catch (err) {
        console.error("Error setting up Firestore streams", err);
        setLoading(false);
      }
    };

    initializeDataStreams();

    return () => {
      unsubscribeCushions();
      unsubscribeCustomers();
      unsubscribeConfig();
      unsubscribeRoomConfig();
    };
  }, []);

  // AUTOMATIC OR MANUAL SALES DAY RESET HANDLER (営業日データクリア処理)
  // Frees all cushions, clears active queue, resets sequential numbering to #001
  const performSystemReset = async (todayStr: string, capacity: number = 20) => {
    try {
      const batch = writeBatch(db);

      // A. Fetch current cushions and set customerId = null (free seats)
      const cushionsSnap = await getDocs(collection(db, 'cushions'));
      cushionsSnap.forEach(snap => {
        batch.update(doc(db, 'cushions', snap.id), { customerId: null });
      });

      // B. Fetch actively waiting/called/moving customers and set status = 'completed' or delete them
      const customersSnap = await getDocs(collection(db, 'customers'));
      customersSnap.forEach(snap => {
        batch.delete(doc(db, 'customers', snap.id)); // Delete to clear lists cleanly
      });

      // C. Reset configs
      batch.update(doc(db, 'config', 'global'), {
        lastResetDate: todayStr,
        nextSeq: 1,
        capacity: capacity,
        callingStopped: false,
      });

      await batch.commit();
      console.log("System daily reset committed successfully.");
    } catch (err) {
      console.error("Error committing daily reset batch", err);
    }
  };

  const handleManualReset = () => {
    const todayStr = getTodayLocalDateString();
    performSystemReset(todayStr, config?.capacity || 20);
  };

  const handleSaveAvailability = async (slots: AvailabilitySlot[]) => {
    try {
      await updateDoc(doc(db, 'config', 'global'), { availabilitySlots: slots });
    } catch (err) {
      console.error(err);
    }
  };

  // 依頼（移動中チケット）を選択中に、依頼カード・座布団以外をクリックしたら選択を解除する
  useEffect(() => {
    if (!pickRequestId) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-req-card]') || target.closest('[id^="cushion-card-"]')) return;
      setPickRequestId(null);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [pickRequestId]);

  const toggleSelectRequest = (customerId: string) => {
    setPickRequestId(prev => (prev === customerId ? null : customerId));
  };

  const startEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setCustomGroupSize(customer.groupSize);
  };

  const saveEditedCustomerGroupSize = async () => {
    if (!editingCustomer) return;
    try {
      await updateDoc(doc(db, 'customers', editingCustomer.id), {
        groupSize: customGroupSize
      });
      setEditingCustomer(null);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || !config || !roomConfig) {
    return (
      <div className="min-h-screen bg-natural-beige flex flex-col items-center justify-center p-8 text-center text-natural-wood">
        <div className="text-4xl text-natural-clay animate-pulse font-bold leading-none mb-4 select-none">♨</div>
        <p className="text-sm font-semibold tracking-wider text-natural-wood/80 animate-pulse">
          お風呂休憩室データを読み込み中...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-natural-sand/30 flex flex-col font-sans select-none overflow-x-hidden text-natural-wood">
      {/* Dynamic Header Component */}
      <Header
        config={config}
        onOpenAdmin={() => setShowAdminPanel(true)}
        onSaveAvailability={handleSaveAvailability}
      />

      {/* Main Core Layout Bento Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col lg:flex-row gap-6 items-stretch">

        {/* Left Side Section: Seat Arrangement Map */}
        <CushionMap
          cushions={cushions}
          customers={customers}
          onEditCustomer={startEditCustomer}
          roomConfig={roomConfig}
          pickRequestId={pickRequestId}
          onClearPickRequest={() => setPickRequestId(null)}
        />

        {/* Right Side Section: Live Sidebar Queue and Management Controls */}
        <QueueSidebar
          customers={customers}
          config={config}
          pickRequestId={pickRequestId}
          onToggleSelectRequest={toggleSelectRequest}
        />
      </main>

      {/* Edit Customer Group Size Modal Dialog (人数の途中変更) */}
      {editingCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded max-w-sm w-full p-6 shadow-2xl border border-natural-border flex flex-col gap-4 animate-in duration-150 text-natural-wood">
            <div className="flex items-center justify-between border-b-2 border-natural-clay pb-2">
              <span className="text-sm font-bold text-natural-wood flex items-center gap-1.5 tracking-wide">
                <Users size={16} className="text-natural-clay" />
                グループ人数の変更 ({editingCustomer.ticketNumber})
              </span>
              <button
                onClick={() => setEditingCustomer(null)}
                className="text-natural-clay hover:text-natural-wood cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-3 py-2">
              <label className="text-xs font-bold text-natural-clay text-center">
                登録人数を変更してください
              </label>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setCustomGroupSize(Math.max(1, customGroupSize - 1))}
                  className="w-16 h-16 rounded-xl text-4xl font-bold bg-natural-beige border-2 border-natural-clay/60 text-natural-clay hover:bg-natural-khaki cursor-pointer transition-all flex items-center justify-center select-none"
                >
                  −
                </button>
                <span className="flex-1 text-center text-6xl font-extrabold text-natural-wood tabular-nums">
                  {customGroupSize}
                </span>
                <button
                  type="button"
                  onClick={() => setCustomGroupSize(customGroupSize + 1)}
                  className="w-16 h-16 rounded-xl text-4xl font-bold bg-natural-clay text-white hover:bg-natural-clay/90 cursor-pointer transition-all flex items-center justify-center select-none"
                >
                  +
                </button>
              </div>
            </div>

            <div className="bg-[#FAF7F2] border border-natural-border/50 rounded p-2.5 flex items-start gap-1.5 text-[11px] text-natural-wood">
              <Info size={14} className="shrink-0 text-natural-clay mt-0.5" />
              <span>人数の変更は、このお座席及び関連する全マップ座布団上の表示がリアルタイムに更新されます。</span>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setEditingCustomer(null)}
                className="flex-1 py-2 border border-natural-border hover:bg-stone-50 text-natural-wood rounded text-xs font-bold transition-all cursor-pointer"
              >
                閉じる
              </button>
              <button
                onClick={saveEditedCustomerGroupSize}
                className="flex-1 py-2 bg-natural-olive hover:bg-natural-olive/90 text-white rounded text-xs font-extrabold transition-all cursor-pointer shadow-md"
              >
                人数を変更する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Settings Panel Modal (部屋・座布団サイズ・レイアウト管理画面) */}
      {showAdminPanel && (
        <AdminPanel
          roomConfig={roomConfig}
          config={config}
          onClose={() => setShowAdminPanel(false)}
        />
      )}
    </div>
  );
}
