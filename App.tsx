/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  ShoppingBag,
  Clock,
  Plus,
  Minus,
  CheckCircle2,
  Lock,
  ArrowRight,
  ChefHat,
  Utensils,
  MapPin,
  Bike,
  Star,
  Tag,
  SlidersHorizontal,
  Store,
  ClipboardList,
  Shield,
  BookOpen,
} from 'lucide-react';
import type {
  TblUser,
  TblRestaurant,
  TblCategory,
  TblMenuItem,
  TblTimeWindow,
  TblOrder,
  TblOrderDetail,
  TblBatchOrder,
  CartItem,
  PaymentMethod,
  BatchOrderStatus,
} from './types/database.ts';
import {
  INITIAL_USERS,
  INITIAL_RESTAURANTS,
  INITIAL_CATEGORIES,
  INITIAL_MENU_ITEMS,
  INITIAL_TIME_WINDOWS,
  INITIAL_ORDERS,
  INITIAL_ORDER_DETAILS,
  THESIS_METADATA,
} from './data/seedData.ts';
import {
  formatUsd,
  formatKhr,
  parseTimeToSeconds,
  evaluateTimeWindow,
  calculateCartSummary,
  consolidateBatchOrders,
} from './utils/orderingLogic.ts';
import { DishIllustration } from './components/DishIllustration.tsx';
import { KhqrModal } from './components/KhqrModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { DishCustomizeModal } from './components/DishCustomizeModal.tsx';
import { KdsBatchView } from './components/KdsBatchView.tsx';
import { AdminDashboardView } from './components/AdminDashboardView.tsx';
import { ThesisSchemaView } from './components/ThesisSchemaView.tsx';
import { OrdersHistoryView } from './components/OrdersHistoryView.tsx';

type ActiveSection = 'menu' | 'orders' | 'kds' | 'admin' | 'thesis';
type DeliveryMode = 'batch' | 'delivery' | 'pickup';

const CAMPUS_BUILDINGS = [
  'អគារ A - បន្ទប់ប្រព័ន្ធព័ត៌មានវិទ្យា (IT Lab)',
  'អគារ B - មហាវិទ្យាល័យគណិតវិទ្យា និងវិទ្យាសាស្ត្រ',
  'អគារ C - មហាវិទ្យាល័យគ្រប់គ្រងពាណិជ្ជកម្ម',
  'អគាររដ្ឋបាលកណ្តាល - ជាន់ទី១ (Admin Office)',
  'បន្ទប់សាស្ត្រាចារ្យ និងស្រាវជ្រាវ (Faculty Lounge)',
];

const RESTAURANT_RATINGS: Record<number, { rating: string; reviews: number; minOrder: string }> = {
  1: { rating: '4.9', reviews: 320, minOrder: '$1.50' },
  2: { rating: '4.8', reviews: 245, minOrder: '$1.25' },
  3: { rating: '4.9', reviews: 410, minOrder: '$1.00' },
};

export default function App() {
  // Navigation state
  const [activeSection, setActiveSection] = useState<ActiveSection>('menu');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('batch');

  // Relational Database State (8 Tables from Chapter 3 Section 3.2.3)
  const [users, setUsers] = useState<TblUser[]>(INITIAL_USERS);
  const [currentUser, setCurrentUser] = useState<TblUser>(INITIAL_USERS[0]);
  const [restaurants] = useState<TblRestaurant[]>(INITIAL_RESTAURANTS);
  const [categories] = useState<TblCategory[]>(INITIAL_CATEGORIES);
  const [menuItems, setMenuItems] = useState<TblMenuItem[]>(INITIAL_MENU_ITEMS);
  const [timeWindows, setTimeWindows] = useState<TblTimeWindow[]>(INITIAL_TIME_WINDOWS);
  const [activeWindowId, setActiveWindowId] = useState<number>(1);
  const [orders, setOrders] = useState<TblOrder[]>(INITIAL_ORDERS);
  const [orderDetails, setOrderDetails] = useState<TblOrderDetail[]>(INITIAL_ORDER_DETAILS);
  const [batchStatusOverrides, setBatchStatusOverrides] = useState<Record<number, BatchOrderStatus>>({
    1: 'Preparing',
    2: 'Pending',
    3: 'Delivering',
  });

  // Simulated system clock for deterministic Cut-off Time testing
  const [simulatedTimeStr, setSimulatedTimeStr] = useState<string>('09:45');
  const [elapsedTickSeconds, setElapsedTickSeconds] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTickSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSimulatedTimeChange = (newTimeStr: string) => {
    setSimulatedTimeStr(newTimeStr);
    setElapsedTickSeconds(0);
  };

  // Menu Filters
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Cart, Promo Voucher & Modals State
  const [cart, setCart] = useState<CartItem[]>([
    {
      item: INITIAL_MENU_ITEMS[0], // Steamed Fish Amok ($2.75)
      quantity: 1,
      special_request: 'សូមដាក់ម្ទេសដាច់ដោយឡែក',
    },
  ]);
  const [promoCode, setPromoCode] = useState<string>('');
  const [customizingDish, setCustomizingDish] = useState<TblMenuItem | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('KHQR');
  const [deliveryDropPoint, setDeliveryDropPoint] = useState<string>(CAMPUS_BUILDINGS[0]);
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const activeWindow =
    timeWindows.find((w) => w.window_id === activeWindowId) || timeWindows[0];

  const currentSecondsOfDay =
    parseTimeToSeconds(simulatedTimeStr) + elapsedTickSeconds;

  const windowEval = useMemo(
    () => evaluateTimeWindow(activeWindow, currentSecondsOfDay),
    [activeWindow, currentSecondsOfDay]
  );

  // Consolidated Batches (Process 4.0)
  const consolidatedBatches: TblBatchOrder[] = useMemo(() => {
    const rawBatches = consolidateBatchOrders({
      windowId: activeWindow.window_id,
      orders,
      orderDetails,
      menuItems,
      restaurants,
      users,
    });
    return rawBatches.map((b) => ({
      ...b,
      batch_status: batchStatusOverrides[b.restaurant_id] || b.batch_status,
    }));
  }, [activeWindow.window_id, orders, orderDetails, menuItems, restaurants, users, batchStatusOverrides]);

  const cartSummary = useMemo(
    () => calculateCartSummary(cart, promoCode),
    [cart, promoCode]
  );

  // Filtered Menu Items
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (selectedCategoryId !== 'all' && item.category_id !== selectedCategoryId) {
        return false;
      }
      if (selectedRestaurantId !== 'all' && item.restaurant_id !== selectedRestaurantId) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchKh = item.item_name.toLowerCase().includes(q);
        const matchEn = item.item_name_en.toLowerCase().includes(q);
        const matchDesc = item.description.toLowerCase().includes(q);
        return matchKh || matchEn || matchDesc;
      }
      return true;
    });
  }, [menuItems, selectedCategoryId, selectedRestaurantId, searchQuery]);

  const restaurantMap = useMemo(
    () => new Map<number, TblRestaurant>(restaurants.map((r) => [r.restaurant_id, r])),
    [restaurants]
  );
  const categoryMap = useMemo(
    () => new Map<number, TblCategory>(categories.map((c) => [c.category_id, c])),
    [categories]
  );

  // Cart Handlers
  const handleQuickAddToCart = (dish: TblMenuItem) => {
    if (!windowEval.isOpen || !dish.is_available) return;
    setCart((prev) => {
      const existingIdx = prev.findIndex((c) => c.item.item_id === dish.item_id);
      if (existingIdx > -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + 1,
        };
        return updated;
      }
      return [...prev, { item: dish, quantity: 1, special_request: '' }];
    });
  };

  const handleAddCustomizedToCart = (
    dish: TblMenuItem,
    quantity: number,
    customNotes: string,
    extraPriceUsd: number
  ) => {
    if (!windowEval.isOpen || !dish.is_available) return;
    const adjustedDish: TblMenuItem =
      extraPriceUsd > 0
        ? { ...dish, price: Number((dish.price + extraPriceUsd).toFixed(2)) }
        : dish;

    setCart((prev) => {
      const existingIdx = prev.findIndex((c) => c.item.item_id === dish.item_id);
      if (existingIdx > -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          item: adjustedDish,
          quantity: updated[existingIdx].quantity + quantity,
          special_request: customNotes || updated[existingIdx].special_request,
        };
        return updated;
      }
      return [...prev, { item: adjustedDish, quantity, special_request: customNotes }];
    });
  };

  const handleUpdateCartQuantity = (itemId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.item.item_id === itemId
            ? { ...c, quantity: Math.max(0, c.quantity + delta) }
            : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const handleUpdateSpecialRequest = (itemId: number, note: string) => {
    setCart((prev) =>
      prev.map((c) =>
        c.item.item_id === itemId ? { ...c, special_request: note } : c
      )
    );
  };

  const handleConfirmOrder = () => {
    if (!windowEval.isOpen || cart.length === 0) return;

    const nextOrderId =
      orders.reduce((max, o) => Math.max(max, o.order_id), 1000) + 1;
    let nextDetailId =
      orderDetails.reduce((max, d) => Math.max(max, d.detail_id), 0) + 1;

    const newOrder: TblOrder = {
      order_id: nextOrderId,
      user_id: currentUser.user_id,
      window_id: activeWindow.window_id,
      total_amount: cartSummary.totalUsd,
      payment_method: selectedPayment,
      order_status: 'Confirmed',
      notes: orderNotes.trim(),
      delivery_drop_point:
        deliveryDropPoint.trim() || `អគារសិក្សា - ${currentUser.department}`,
      created_at: new Date().toISOString(),
    };

    const newDetails: TblOrderDetail[] = cart.map((entry) => ({
      detail_id: nextDetailId++,
      order_id: nextOrderId,
      item_id: entry.item.item_id,
      quantity: entry.quantity,
      subtotal: Number((entry.item.price * entry.quantity).toFixed(2)),
      special_request: entry.special_request.trim() || undefined,
    }));

    setOrders((prev) => [newOrder, ...prev]);
    setOrderDetails((prev) => [...newDetails, ...prev]);
    setCart([]);
    setOrderNotes('');
    setIsCheckoutOpen(false);
    setBannerNotice(
      `ការបញ្ជាទិញលេខ #${nextOrderId} (${formatUsd(cartSummary.totalUsd)}) ត្រូវបានបញ្ជូនទៅផ្ទះបាយ KDS រួចរាល់!`
    );
    setActiveSection('orders');
  };

  const handleCancelOrder = (orderId: number) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.order_id === orderId ? { ...o, order_status: 'Cancelled' } : o
      )
    );
    setBannerNotice(`វិក្កយបត្រលេខ #${orderId} ត្រូវបានបោះបង់មុនម៉ោង Cut-off។`);
  };

  const handleUpdateWindow = (updated: TblTimeWindow) => {
    setTimeWindows((prev) =>
      prev.map((w) => (w.window_id === updated.window_id ? updated : w))
    );
  };

  const handleConsolidateAndLockWindow = () => {
    handleUpdateWindow({ ...activeWindow, status: 'Closed' });
    setBannerNotice(
      `បានបិទម៉ោង Cut-off (${activeWindow.end_time}) និងបញ្ជូនបញ្ជីបូកសរុបរួម (Batch Orders) ចំនួន ${consolidatedBatches.length} ភោជនីយដ្ឋានទៅកាន់ផ្ទះបាយ KDS រួចរាល់!`
    );
    setActiveSection('kds');
  };

  const handleUpdateBatchStatus = (batchId: number, nextStatus: BatchOrderStatus) => {
    const target = consolidatedBatches.find((b) => b.batch_id === batchId);
    if (!target) return;
    setBatchStatusOverrides((prev) => ({
      ...prev,
      [target.restaurant_id]: nextStatus,
    }));
  };

  const handleAddMenuItem = (newItemData: Omit<TblMenuItem, 'item_id'>) => {
    const nextId =
      menuItems.reduce((max, m) => Math.max(max, m.item_id), 100) + 1;
    setMenuItems((prev) => [{ item_id: nextId, ...newItemData }, ...prev]);
  };

  const handleToggleMenuItemAvailability = (itemId: number) => {
    setMenuItems((prev) =>
      prev.map((m) =>
        m.item_id === itemId ? { ...m, is_available: !m.is_available } : m
      )
    );
  };

  const handleDeleteMenuItem = (itemId: number) => {
    setMenuItems((prev) => prev.filter((m) => m.item_id !== itemId));
    setCart((prev) => prev.filter((c) => c.item.item_id !== itemId));
  };

  const tableCounts: Record<string, number> = {
    tbl_users: users.length,
    tbl_restaurants: restaurants.length,
    tbl_categories: categories.length,
    tbl_menu_items: menuItems.length,
    tbl_time_windows: timeWindows.length,
    tbl_orders: orders.length,
    tbl_order_details: orderDetails.length,
    tbl_batch_orders: consolidatedBatches.length,
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F7F9] text-slate-900 pb-20 lg:pb-0">
      {/* STRICT 3-ZONE TOP BAR CONTRACT (foodpanda Magenta Identity) */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 sm:gap-8 px-3 sm:px-6 py-3 bg-white border-b border-slate-200 shadow-2xs no-print">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('menu');
          }}
          className="text-base sm:text-xl font-extrabold tracking-tight text-[#D70F64] whitespace-nowrap truncate max-w-[195px] sm:max-w-none shrink-0"
        >
          pandaBatch · ម្ហូបទំនើប DIU
        </a>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav
          aria-label="របារម៉ឺនុយគោល"
          className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => setActiveSection('menu')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'menu'
                ? 'border-[#D70F64] text-[#D70F64] font-bold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            ហាង និងម៉ឺនុយម្ហូប
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('orders')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'orders'
                ? 'border-[#D70F64] text-[#D70F64] font-bold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            តាមដានការកម្ម៉ង់ ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('kds')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'kds'
                ? 'border-[#D70F64] text-[#D70F64] font-bold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            ផ្ទះបាយ KDS & ដឹកជញ្ជូន
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('admin')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'admin'
                ? 'border-[#D70F64] text-[#D70F64] font-bold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            គ្រប់គ្រងប្រព័ន្ធ (Admin)
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('thesis')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'thesis'
                ? 'border-[#D70F64] text-[#D70F64] font-bold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            ឯកសារសារណា & Database
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-[#D70F64] rounded-xl hover:bg-[#B80C55] transition-colors whitespace-nowrap truncate max-w-[160px] sm:max-w-none shrink-0"
          >
            {currentUser.full_name} ({currentUser.role})
          </button>
        </div>
      </header>

      {/* Main Content Container (1440px baseline presence) */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
        {/* Confirmation / System Banner Notice */}
        {bannerNotice && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-[#FBCFE8] bg-[#FDF2F7] px-5 py-3.5 text-sm text-slate-900 no-print">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-[#D70F64] shrink-0" />
              <span className="font-medium">{bannerNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-xs font-semibold text-[#D70F64] underline whitespace-nowrap"
            >
              បិទសារ
            </button>
          </div>
        )}

        {/* VIEW 1: FOODPANDA-STYLE STOREFRONT & CORPORATE BATCH ORDERING */}
        {activeSection === 'menu' && (
          <div className="space-y-7">
            {/* Sub-header Bar: Campus Delivery Location Picker & Service Mode Switcher */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-2xl border border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#FDF2F7] text-[#D70F64] flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-500">
                    ដឹកជញ្ជូនទៅកាន់អគារក្នុងសាកលវិទ្យាល័យអន្តរជាតិ ឌូវី (DIU Campus)
                  </div>
                  <select
                    aria-label="ជ្រើសរើសអគារទទួលអាហារ"
                    value={deliveryDropPoint}
                    onChange={(e) => setDeliveryDropPoint(e.target.value)}
                    className="text-xs sm:text-sm font-bold text-slate-900 bg-transparent focus:outline-hidden cursor-pointer truncate max-w-full"
                  >
                    {CAMPUS_BUILDINGS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* foodpanda Service Mode Segmented Tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 w-full md:w-auto">
                <button
                  type="button"
                  onClick={() => setDeliveryMode('batch')}
                  className={`flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    deliveryMode === 'batch'
                      ? 'bg-[#D70F64] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>កម្ម៉ង់រួម Cut-off</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMode('delivery')}
                  className={`flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    deliveryMode === 'delivery'
                      ? 'bg-[#D70F64] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Bike className="w-3.5 h-3.5 shrink-0" />
                  <span>ដឹកជញ្ជូនរហ័ស</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMode('pickup')}
                  className={`flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    deliveryMode === 'pickup'
                      ? 'bg-[#D70F64] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Store className="w-3.5 h-3.5 shrink-0" />
                  <span>ទៅយកផ្ទាល់</span>
                </button>
              </div>
            </div>

            {/* foodpanda Magenta Hero Campaign Banner + Live Cut-off Time Window */}
            <section className="rounded-3xl bg-gradient-to-r from-[#D70F64] via-[#C20D5A] to-[#9D0B48] text-white p-6 sm:p-8 shadow-sm overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                <div className="lg:col-span-7 space-y-4">
                  <div className="text-xs font-medium text-pink-100">
                    <span>{THESIS_METADATA.universityKh}</span>
                    <span aria-hidden="true"> · </span>
                    <span>ប្រព័ន្ធដឹកជញ្ជូនម្ហូបទំនើបតាមម៉ោងកំណត់ (Batch Ordering)</span>
                  </div>

                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-balance leading-tight">
                    ឃ្លានអ្វីដែរថ្ងៃត្រង់នេះ? កម្ម៉ង់មុនម៉ោង {activeWindow.end_time} ដឹកដល់អគារឥតគិតថ្លៃ!
                  </h1>

                  {/* Embedded foodpanda Search Bar */}
                  <div className="relative max-w-xl">
                    <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      aria-label="ស្វែងរកភោជនីយដ្ឋាន ឬមុខម្ហូប"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ស្វែងរកមុខម្ហូប អាម៉ុក ឡុកឡាក់ គុយទាវ ឬកាហ្វេ..."
                      className="w-full pl-12 pr-28 py-3.5 rounded-2xl bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-md focus:outline-hidden"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-bold text-[#D70F64] bg-pink-50 rounded-lg"
                      >
                        សម្អាត
                      </button>
                    )}
                  </div>

                  {/* Campus Voucher Strip */}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                    <span className="text-pink-100">
                      ប្រូម៉ូសិនពិសេសសម្រាប់បុគ្គលិក និងនិស្សិត DIU៖
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPromoCode('DIU2026');
                        setBannerNotice(
                          'បានអនុវត្តកូដបញ្ចុះតម្លៃ DIU2026 (បញ្ចុះ 15% សម្រាប់ការកម្ម៉ង់មុនម៉ោង Cut-off)!'
                        );
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-[#D70F64] font-bold hover:bg-pink-50 transition-colors whitespace-nowrap shadow-2xs"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      <span>
                        {promoCode === 'DIU2026'
                          ? 'បានប្រើកូដ DIU2026 (-15%)'
                          : 'ចុចយកកូដ DIU2026 បញ្ចុះ 15%'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Right 5 Cols: Live Cut-off Time Window Card */}
                <div className="lg:col-span-5">
                  <div className="rounded-2xl bg-slate-950/90 backdrop-blur-xs border border-white/15 p-5 text-white">
                    <div className="flex items-center justify-between text-xs text-pink-200">
                      <span>{activeWindow.window_name}</span>
                      <span className="font-mono-tabular">
                        {activeWindow.start_time} – {activeWindow.end_time}
                      </span>
                    </div>

                    <div className="mt-3 flex items-baseline justify-between gap-4">
                      <div>
                        <div className="text-xs text-slate-300">
                          {windowEval.isOpen
                            ? 'រាប់ថយក្រោយម៉ោងបិទ Cut-off (Countdown)'
                            : 'ស្ថានភាពទទួលការកម្ម៉ង់ (Cut-off Closed)'}
                        </div>
                        <div
                          data-testid="cutoff-countdown"
                          className="text-3xl sm:text-4xl font-extrabold font-mono-tabular tracking-tight mt-0.5 text-[#FF6B9E]"
                        >
                          {windowEval.formattedCountdown}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-bold text-white">
                          {windowEval.isOpen ? 'កំពុងបើកទទួល Order' : 'បានបិទស្វ័យប្រវត្តិ'}
                        </div>
                        <div className="text-[11px] text-slate-300 mt-0.5">
                          ដឹកដល់អគារ៖ {activeWindow.delivery_time}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-300">
                        បូកសរុបរួមក្នុងវេននេះ៖ {orders.length} វិក្កយបត្រ
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (windowEval.isOpen) {
                            handleUpdateWindow({ ...activeWindow, status: 'Closed' });
                          } else {
                            handleSimulatedTimeChange('09:45');
                            handleUpdateWindow({ ...activeWindow, status: 'Open' });
                          }
                        }}
                        className="font-bold text-[#FF6B9E] hover:text-white underline whitespace-nowrap"
                      >
                        {windowEval.isOpen
                          ? 'សាកល្បងបិទម៉ោង Cut-off'
                          : 'បើកម៉ោងទទួលការកម្ម៉ង់ឡើងវិញ'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* foodpanda Storefront Workspace: Left 8 Cols (Restaurants + Categories + Dishes) & Right 4 Cols (Sticky Cart) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 8 Cols */}
              <div className="lg:col-span-8 space-y-6">
                {/* Partner Restaurants Carousel / Grid (foodpanda Storefront style) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">
                      ភោជនីយដ្ឋានដៃគូក្នុងសាកលវិទ្យាល័យ (Partner Restaurants)
                    </h2>
                    {selectedRestaurantId !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setSelectedRestaurantId('all')}
                        className="text-xs font-bold text-[#D70F64] hover:underline"
                      >
                        បង្ហាញគ្រប់ភោជនីយដ្ឋានទាំងអស់
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {restaurants.map((rest) => {
                      const isSelected = selectedRestaurantId === rest.restaurant_id;
                      const meta = RESTAURANT_RATINGS[rest.restaurant_id] || {
                        rating: '4.8',
                        reviews: 150,
                        minOrder: '$1.50',
                      };
                      return (
                        <button
                          key={rest.restaurant_id}
                          type="button"
                          onClick={() =>
                            setSelectedRestaurantId(
                              isSelected ? 'all' : rest.restaurant_id
                            )
                          }
                          className={`p-4 rounded-2xl border text-left transition-all ${
                            isSelected
                              ? 'border-[#D70F64] bg-[#FDF2F7] shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span className="font-semibold text-[#D70F64]">
                              ដឹកឥតគិតថ្លៃ · ~{rest.prep_lead_minutes} នាទី
                            </span>
                            <span className="flex items-center gap-1 font-mono-tabular font-bold text-slate-800">
                              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                              {meta.rating} ({meta.reviews})
                            </span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 mt-1.5 truncate">
                            {rest.name}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {rest.specialty}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Category Filter Tabs */}
                <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId('all')}
                    className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategoryId === 'all'
                        ? 'bg-[#D70F64] text-white shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    គ្រប់មុខម្ហូបពេញនិយម ({menuItems.length})
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat.category_id}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.category_id)}
                      className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategoryId === cat.category_id
                          ? 'bg-[#D70F64] text-white shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {cat.category_name}
                    </button>
                  ))}
                </div>

                {/* foodpanda Dish Grid */}
                {filteredMenuItems.length === 0 ? (
                  <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
                    <Utensils className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <div className="text-sm font-bold text-slate-900">
                      មិនមានមុខម្ហូបដែលស្វែងរកនោះទេ
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategoryId('all');
                        setSelectedRestaurantId('all');
                        setSearchQuery('');
                      }}
                      className="mt-3 px-4 py-1.5 text-xs font-bold text-[#D70F64] underline"
                    >
                      បង្ហាញមុខម្ហូបទាំងអស់ឡើងវិញ
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {filteredMenuItems.map((dish) => {
                      const rest = restaurantMap.get(dish.restaurant_id);
                      const cat = categoryMap.get(dish.category_id);
                      const inCart = cart.find((c) => c.item.item_id === dish.item_id);

                      return (
                        <article
                          key={dish.item_id}
                          className="group bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5 hover:border-slate-300"
                        >
                          <div>
                            {/* 4:3 Culinary Artwork Container */}
                            <div className="aspect-4/3 w-full bg-slate-900 overflow-hidden relative">
                              <DishIllustration
                                imageKey={dish.image}
                                alt={dish.item_name}
                                className="w-full h-full"
                              />
                            </div>

                            {/* Card Body — Clean Unboxed Metadata */}
                            <div className="p-4 space-y-1.5">
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className="truncate">{rest?.name}</span>
                                <span aria-hidden="true">·</span>
                                <span className="whitespace-nowrap">{cat?.category_name}</span>
                              </div>

                              <h3 className="text-base font-bold text-slate-900 leading-snug">
                                {dish.item_name}
                              </h3>
                              <div className="text-xs text-slate-500">
                                {dish.item_name_en}
                              </div>

                              <p className="text-xs text-slate-600 line-clamp-2 pt-1">
                                {dish.description}
                              </p>
                            </div>
                          </div>

                          {/* Card Footer: Tabular Price + Customize & Quick-Add Buttons */}
                          <div className="px-4 pb-4 pt-2.5 flex items-center justify-between border-t border-slate-100 gap-2">
                            <div className="font-mono-tabular">
                              <div className="text-base font-extrabold text-[#D70F64]">
                                {formatUsd(dish.price)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatKhr(dish.price)}
                              </div>
                            </div>

                            {!windowEval.isOpen ? (
                              <span className="text-xs font-semibold text-red-700 flex items-center gap-1">
                                <Lock className="w-3.5 h-3.5" />
                                <span>បានបិទម៉ោង</span>
                              </span>
                            ) : !dish.is_available ? (
                              <span className="text-xs font-semibold text-slate-400">
                                អស់ស្តុកថ្ងៃនេះ
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCustomizingDish(dish)}
                                  aria-label={`ជ្រើសរើសរសជាតិ ${dish.item_name}`}
                                  className="px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                                >
                                  ជម្រើស
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQuickAddToCart(dish)}
                                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-[#D70F64] hover:bg-[#B80C55] transition-colors whitespace-nowrap shrink-0 shadow-2xs"
                                >
                                  <Plus className="w-4 h-4" />
                                  <span>
                                    ដាក់កន្ត្រក{inCart ? ` (${inCart.quantity})` : ''}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right 4 Cols: foodpanda Sticky Order Cart & Batch Preview */}
              <aside className="lg:col-span-4 lg:sticky lg:top-20 space-y-5">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="w-5 h-5 text-[#D70F64]" />
                      <h2 className="text-base font-bold text-slate-900">
                        កន្ត្រកអាហាររបស់អ្នក (Your Cart)
                      </h2>
                    </div>
                    <span className="text-xs font-mono-tabular font-bold text-[#D70F64]">
                      {cartSummary.totalItems} មុខ
                    </span>
                  </div>

                  {/* Active Staff User & Delivery Building Info */}
                  <div className="text-xs text-slate-600 bg-[#FDF2F7]/70 px-3.5 py-2.5 rounded-xl border border-[#FBCFE8] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        {currentUser.full_name} ({currentUser.student_or_staff_code})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAuthModalOpen(true)}
                        className="font-bold text-[#D70F64] hover:underline whitespace-nowrap"
                      >
                        ប្តូរគណនី
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-600 truncate">
                      ដឹកទៅ៖ {deliveryDropPoint}
                    </div>
                  </div>

                  {cart.length === 0 ? (
                    <div className="py-8 text-center space-y-2">
                      <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-xs text-slate-500">
                        មិនទាន់មានមុខម្ហូបក្នុងកន្ត្រកទេ។ សូមចុច «+ ដាក់កន្ត្រក» លើមុខម្ហូបដែលអ្នកចូលចិត្ត!
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 max-h-72 overflow-y-auto pr-1">
                      {cart.map((entry) => (
                        <div key={entry.item.item_id} className="py-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-bold text-slate-900">
                                {entry.item.item_name}
                              </div>
                              <div className="text-xs text-slate-500 font-mono-tabular">
                                {formatUsd(entry.item.price)} × {entry.quantity} ={' '}
                                <span className="font-bold text-[#D70F64]">
                                  {formatUsd(entry.item.price * entry.quantity)}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateCartQuantity(entry.item.item_id, -1)
                                }
                                aria-label={`បន្ថយចំនួន ${entry.item.item_name}`}
                                className="p-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="w-6 text-center text-xs font-bold font-mono-tabular">
                                {entry.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateCartQuantity(entry.item.item_id, 1)
                                }
                                aria-label={`បន្ថែមចំនួន ${entry.item.item_name}`}
                                className="p-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <input
                            type="text"
                            aria-label={`ចំណាំសម្រាប់ ${entry.item.item_name}`}
                            value={entry.special_request}
                            onChange={(e) =>
                              handleUpdateSpecialRequest(
                                entry.item.item_id,
                                e.target.value
                              )
                            }
                            placeholder="ចំណាំ៖ ឧ. អត់ហឹរ, ថែមបន្លែ..."
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-800 focus:border-[#D70F64] focus:bg-white focus:outline-hidden"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Voucher Code Input */}
                  {cart.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <Tag className="w-4 h-4 text-[#D70F64] shrink-0" />
                      <input
                        type="text"
                        aria-label="កូដបញ្ចុះតម្លៃ (Voucher Code)"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value)}
                        placeholder="បញ្ចូលកូដប្រូម៉ូសិន (ឧ. DIU2026)"
                        className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 font-mono-tabular uppercase focus:border-[#D70F64] focus:outline-hidden"
                      />
                      {promoCode !== 'DIU2026' ? (
                        <button
                          type="button"
                          onClick={() => setPromoCode('DIU2026')}
                          className="px-2.5 py-1.5 text-xs font-bold text-[#D70F64] bg-[#FDF2F7] rounded-lg whitespace-nowrap"
                        >
                          ប្រើ DIU2026
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPromoCode('')}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 whitespace-nowrap"
                        >
                          ដកចេញ
                        </button>
                      )}
                    </div>
                  )}

                  {/* Totals & Checkout CTA */}
                  <div className="pt-3 border-t border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>ថ្លៃដឹកជញ្ជូនក្នុងសាកលវិទ្យាល័យ (Campus Delivery)</span>
                      <span className="font-bold text-emerald-700 font-mono-tabular">
                        ឥតគិតថ្លៃ ($0.00)
                      </span>
                    </div>

                    {cartSummary.discountUsd > 0 && (
                      <div className="flex items-center justify-between text-xs font-semibold text-[#D70F64]">
                        <span>បញ្ចុះតម្លៃកូដ DIU2026 (15%)</span>
                        <span className="font-mono-tabular">
                          -{formatUsd(cartSummary.discountUsd)}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-sm pt-1">
                      <span className="font-bold text-slate-900">សរុបទឹកប្រាក់ (USD)</span>
                      <span
                        data-testid="cart-total-usd"
                        className="text-lg font-extrabold text-[#D70F64] font-mono-tabular"
                      >
                        {formatUsd(cartSummary.totalUsd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 font-mono-tabular">
                      <span>គិតជាប្រាក់រៀល (1$ = 4,100៛)</span>
                      <span>{formatKhr(cartSummary.totalUsd)}</span>
                    </div>

                    <button
                      type="button"
                      disabled={!windowEval.isOpen || cart.length === 0}
                      onClick={() => setIsCheckoutOpen(true)}
                      className={`w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-sm font-bold transition-colors ${
                        !windowEval.isOpen || cart.length === 0
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-[#D70F64] hover:bg-[#B80C55] text-white shadow-sm'
                      }`}
                    >
                      {!windowEval.isOpen ? (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>បានផុតម៉ោងទទួលការកម្ម៉ង់ (Cut-off Closed)</span>
                        </>
                      ) : (
                        <>
                          <span>បន្តទៅផ្ទៀងផ្ទាត់ និងទូទាត់ប្រាក់ (KHQR)</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Live Kitchen Batch Consolidation Preview Card */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                      <ChefHat className="w-4 h-4 text-[#D70F64]" />
                      <span>បញ្ជីបូកសរុបរួមក្នុងវេននេះ (Batch Status)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSection('kds')}
                      className="text-xs font-bold text-[#D70F64] hover:underline"
                    >
                      បើក KDS →
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">
                    ការកម្ម៉ង់របស់បុគ្គលិកទាំងអស់ត្រូវបានបូកសរុបរួមតាមភោជនីយដ្ឋានដៃគូ៖
                  </p>
                  <div className="divide-y divide-slate-100 text-xs">
                    {consolidatedBatches.map((b) => {
                      const rest = restaurantMap.get(b.restaurant_id);
                      return (
                        <div
                          key={b.batch_id}
                          className="py-2 flex items-center justify-between"
                        >
                          <span className="text-slate-800 font-medium truncate pr-2">
                            {rest?.name}
                          </span>
                          <span className="font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                            {b.total_items} ប្រអប់ · {b.batch_status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* VIEW 2: ORDER HISTORY & RECEIPTS */}
        {activeSection === 'orders' && (
          <OrdersHistoryView
            orders={orders}
            orderDetails={orderDetails}
            menuItems={menuItems}
            users={users}
            windows={timeWindows}
            currentUser={currentUser}
            onCancelOrder={handleCancelOrder}
            isWindowOpen={windowEval.isOpen}
          />
        )}

        {/* VIEW 3: KITCHEN DISPLAY SYSTEM (KDS) & BATCH CONSOLIDATION */}
        {activeSection === 'kds' && (
          <KdsBatchView
            batches={consolidatedBatches}
            restaurants={restaurants}
            activeWindow={activeWindow}
            onUpdateBatchStatus={handleUpdateBatchStatus}
          />
        )}

        {/* VIEW 4: ADMINISTRATOR DASHBOARD */}
        {activeSection === 'admin' && (
          <AdminDashboardView
            windows={timeWindows}
            activeWindowId={activeWindow.window_id}
            onSelectWindowId={setActiveWindowId}
            onUpdateWindow={handleUpdateWindow}
            windowEval={windowEval}
            simulatedTimeStr={simulatedTimeStr}
            onChangeSimulatedTime={handleSimulatedTimeChange}
            onConsolidateAndLockWindow={handleConsolidateAndLockWindow}
            menuItems={menuItems}
            restaurants={restaurants}
            categories={categories}
            onAddMenuItem={handleAddMenuItem}
            onToggleMenuItemAvailability={handleToggleMenuItemAvailability}
            onDeleteMenuItem={handleDeleteMenuItem}
            orders={orders}
            orderDetails={orderDetails}
            users={users}
          />
        )}

        {/* VIEW 5: THESIS DOCUMENTATION, DATABASE SCHEMA & DFD */}
        {activeSection === 'thesis' && (
          <ThesisSchemaView tableCounts={tableCounts} />
        )}
      </main>

      {/* Fixed Mobile Bottom Navigation Bar (10_mobile_touch_apps.md Pattern 1) */}
      <nav
        aria-label="របារម៉ឺនុយទូរស័ព្ទ"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center h-14 px-1 no-print"
      >
        <button
          type="button"
          onClick={() => setActiveSection('menu')}
          className={`flex flex-col items-center justify-center py-1 ${
            activeSection === 'menu' ? 'text-[#D70F64] font-bold' : 'text-slate-500'
          }`}
        >
          <Store className="w-4 h-4" />
          <span className="text-[10px] mt-0.5 truncate">ហាងម្ហូប</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('orders')}
          className={`flex flex-col items-center justify-center py-1 ${
            activeSection === 'orders' ? 'text-[#D70F64] font-bold' : 'text-slate-500'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span className="text-[10px] mt-0.5 truncate">កម្ម៉ង់ ({orders.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('kds')}
          className={`flex flex-col items-center justify-center py-1 ${
            activeSection === 'kds' ? 'text-[#D70F64] font-bold' : 'text-slate-500'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span className="text-[10px] mt-0.5 truncate">ផ្ទះបាយ KDS</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('admin')}
          className={`flex flex-col items-center justify-center py-1 ${
            activeSection === 'admin' ? 'text-[#D70F64] font-bold' : 'text-slate-500'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span className="text-[10px] mt-0.5 truncate">Admin</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('thesis')}
          className={`flex flex-col items-center justify-center py-1 ${
            activeSection === 'thesis' ? 'text-[#D70F64] font-bold' : 'text-slate-500'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span className="text-[10px] mt-0.5 truncate">សារណា</span>
        </button>
      </nav>

      {/* Clean Quiet Academic Footer */}
      <footer className="border-t border-slate-200 bg-white py-5 px-6 text-xs text-slate-500 no-print">
        <div className="max-w-[1380px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            សារណាបញ្ចប់ថ្នាក់បរិញ្ញាបត្រ ជំនាន់ទី១២ ({THESIS_METADATA.academicYear}) · {THESIS_METADATA.universityKh} ({THESIS_METADATA.universityEn})
          </div>
          <div>
            រៀបរៀងដោយ៖ វ៉ាន់ថា សុភ័ក្ត្រនេត្រា (02712) · ហឿត សុវណ្ណារ៉ា (02699) · សំណាង កាន់និកា (02657) · សាស្ត្រាចារ្យដឹកនាំ៖ លោក ហម មុនី
          </div>
        </div>
      </footer>

      {/* Dish Customization Modal (foodpanda Options Sheet) */}
      <DishCustomizeModal
        dish={customizingDish}
        restaurant={
          customizingDish
            ? restaurantMap.get(customizingDish.restaurant_id)
            : undefined
        }
        onClose={() => setCustomizingDish(null)}
        onAddCustomizedToCart={handleAddCustomizedToCart}
      />

      {/* Checkout & KHQR Modal */}
      <KhqrModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cart={cart}
        promoCode={promoCode}
        currentUser={currentUser}
        activeWindow={activeWindow}
        selectedPayment={selectedPayment}
        onSelectPayment={setSelectedPayment}
        deliveryDropPoint={deliveryDropPoint}
        onChangeDropPoint={setDeliveryDropPoint}
        orderNotes={orderNotes}
        onChangeOrderNotes={setOrderNotes}
        onConfirmOrder={handleConfirmOrder}
      />

      {/* User Auth & Quick Role Switcher Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        users={users}
        currentUser={currentUser}
        onSelectUser={(u) => setCurrentUser(u)}
        onRegisterUser={(newU) => setUsers((prev) => [...prev, newU])}
      />
    </div>
  );
}
